"""
OCR for scanned IDs, passports, and image documents via Claude vision.

RAM's query API is text-only, so scanned documents and photos can't be read by
the agent directly. This module turns them into text: it sends the image (or a
scanned PDF) to Claude's vision model, which reads every field — including the
MRZ strip on passports/IDs — and returns structured fields plus all raw text.
That text is then inlined into the RAM query like any other attachment.

Requires ANTHROPIC_API_KEY in the environment (backend/.env). If it's not set,
ocr_available() returns False and the caller falls back to rejecting the file.
"""
from __future__ import annotations

import base64
import io
import json
import os

import anthropic

# Opus 4.8 has the strongest vision in the Claude family — best for the small
# print and machine-readable zone (MRZ) on passports and ID cards.
OCR_MODEL = os.getenv("OCR_MODEL", "claude-opus-4-8")

# Claude's vision API accepts images up to ~5MB and ~3.75 MP; passports/IDs are
# detail-dense, so we keep the long edge near the 2576px high-res ceiling.
_MAX_IMAGE_BYTES = 4_500_000
_MAX_EDGE = 2576
_MAX_PDF_BYTES = 30_000_000  # PDF document blocks cap at 32MB

# Fields we pull out of identity documents. All required (model fills "" when a
# field is absent) — keeps the JSON schema simple and the output predictable.
_FIELDS = [
    ("document_type", "Document type"),
    ("full_name", "Full name"),
    ("document_number", "Document number"),
    ("nationality", "Nationality"),
    ("sex", "Sex"),
    ("date_of_birth", "Date of birth"),
    ("date_of_issue", "Date of issue"),
    ("date_of_expiry", "Date of expiry"),
    ("place_of_birth", "Place of birth"),
    ("issuing_authority", "Issuing authority"),
    ("mrz", "MRZ"),
    ("other_text", "Other text"),
]

_SCHEMA = {
    "type": "object",
    "properties": {key: {"type": "string"} for key, _ in _FIELDS},
    "required": [key for key, _ in _FIELDS],
    "additionalProperties": False,
}

_PROMPT = (
    "You are an expert OCR system for identity documents (passports, national ID "
    "cards, residence permits, driver licenses, and similar).\n\n"
    "Read the attached document and extract every readable piece of text exactly "
    "as printed — transcribe names, numbers, and dates character-for-character, "
    "preserving capitalization and punctuation. For passports and ID cards, "
    "transcribe the machine-readable zone (MRZ) — the rows of characters and "
    "chevrons (<) at the bottom — exactly, one MRZ line per line.\n\n"
    "Fill each field from the document. If a field is not present, use an empty "
    "string. Put any readable text that doesn't map to a specific field "
    "(headers, labels, signatures, secondary-language text, etc.) into "
    "'other_text'. Do not guess or invent values — only transcribe what you can "
    "actually read."
)

_IMAGE_EXTS = {"png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff"}


class OcrError(Exception):
    pass


def ocr_available() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY"))


def is_image_ext(ext: str) -> bool:
    return ext.lower() in _IMAGE_EXTS


def _prepare_image(data: bytes) -> tuple[str, str]:
    """Normalize an image to a base64 JPEG within Claude's size/resolution limits.
    Returns (base64_data, media_type)."""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        raise OcrError("Image OCR requires Pillow (pip install pillow).")
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img)  # honor camera rotation
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
    except Exception as e:
        raise OcrError(f"Could not read image: {e}")

    # Downscale only if needed — keep maximum detail for small print / MRZ.
    if max(img.size) > _MAX_EDGE:
        img.thumbnail((_MAX_EDGE, _MAX_EDGE), Image.LANCZOS)

    quality = 92
    while True:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        out = buf.getvalue()
        if len(out) <= _MAX_IMAGE_BYTES or quality <= 40:
            break
        quality -= 12
    return base64.standard_b64encode(out).decode("utf-8"), "image/jpeg"


def _source_block(data: bytes, ext: str) -> dict:
    if ext == "pdf":
        if len(data) > _MAX_PDF_BYTES:
            raise OcrError("PDF is too large to OCR (over 30MB). Split it into smaller files.")
        b64 = base64.standard_b64encode(data).decode("utf-8")
        return {"type": "document",
                "source": {"type": "base64", "media_type": "application/pdf", "data": b64}}
    b64, media_type = _prepare_image(data)
    return {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}}


def _format_block(fields: dict, name: str) -> str:
    lines = [f"=== Extracted from scanned document: {name} ==="]
    for key, label in _FIELDS:
        if key in ("mrz", "other_text"):
            continue
        val = (fields.get(key) or "").strip()
        if val:
            lines.append(f"{label}: {val}")
    mrz = (fields.get("mrz") or "").strip()
    if mrz:
        lines.append("MRZ:")
        lines.append(mrz)
    other = (fields.get("other_text") or "").strip()
    if other:
        lines.append("Other text:")
        lines.append(other)
    lines.append("=== End of extracted document ===")
    return "\n".join(lines)


async def ocr_document(data: bytes, name: str, ext: str) -> str:
    """Run Claude vision OCR on a scanned PDF or image. Returns a labeled text
    block (structured fields + raw text) ready to inline into a RAM query."""
    if not ocr_available():
        raise OcrError("OCR is not configured — set ANTHROPIC_API_KEY in backend/.env.")

    block = _source_block(data, ext)
    client = anthropic.AsyncAnthropic()
    try:
        resp = await client.messages.create(
            model=OCR_MODEL,
            max_tokens=4096,
            messages=[{"role": "user", "content": [block, {"type": "text", "text": _PROMPT}]}],
            output_config={"format": {"type": "json_schema", "schema": _SCHEMA}},
        )
    except anthropic.APIStatusError as e:
        raise OcrError(f"OCR request failed: {e.message}")
    except Exception as e:
        raise OcrError(f"Could not reach the OCR service: {e}")

    if resp.stop_reason == "refusal":
        raise OcrError("The OCR model declined to read this document.")

    text = next((b.text for b in resp.content if b.type == "text"), None)
    if not text:
        raise OcrError("OCR returned no text — the document may be unreadable.")
    try:
        fields = json.loads(text)
    except json.JSONDecodeError:
        raise OcrError("OCR returned malformed output.")

    block_text = _format_block(fields, name)
    # If nothing but the header/footer came back, treat it as a failed read.
    if len(block_text.splitlines()) <= 2:
        raise OcrError("No readable text found in the document.")
    return block_text
