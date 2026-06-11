"""
SAS RAM Chat UI — FastAPI backend.

Local dev:
    uvicorn main:app --reload --port 8000

Production (Docker):
    uvicorn main:app --host 0.0.0.0 --port $PORT
    Frontend is pre-built at ../frontend/dist and served from "/".

See backend/.env.example for the RAM connection settings.
"""
from __future__ import annotations
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

load_dotenv()

from routers import ram as ram_router
from services import ram as ram_service

app = FastAPI(
    title="SAS RAM Chat UI",
    description="Custom chatbot UI for SAS Retrieval Agent Manager",
    version="0.1.0",
)

# CORS — permissive in dev; in prod the frontend is same-origin so CORS is moot
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ram_router.router)

print(f"✓ RAM connection: {ram_service.status()}")

# ─── Static frontend (same pattern as the Health app) ────────────────
FRONTEND_DIST = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "frontend", "dist"))

if os.path.isdir(FRONTEND_DIST):
    assets_dir = os.path.join(FRONTEND_DIST, "assets")
    if os.path.isdir(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{filename:path}")
    def serve_spa(filename: str):
        if filename.startswith("api/"):
            return {"error": "not found"}, 404
        candidate = os.path.join(FRONTEND_DIST, filename)
        if os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(os.path.join(FRONTEND_DIST, "index.html"))

    print(f"✓ Serving frontend from {FRONTEND_DIST}")
else:
    @app.get("/")
    def root() -> dict:
        return {
            "service": "SAS RAM Chat UI",
            "status": "operational (dev mode — no frontend build found)",
            "ram": ram_service.status(),
            "hint": "run 'npm run build' in frontend/ for production, or run Vite dev server on :5173",
        }

    print(f"⚠ No frontend build at {FRONTEND_DIST} — API-only mode")
