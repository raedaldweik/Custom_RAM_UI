"""
SAS Retrieval Agent Manager (RAM) client.

Wraps the RAM REST API (OpenAPI v1) and handles SAS Viya authentication.
The browser never talks to RAM directly — this backend proxies every call,
which keeps the bearer token server-side and avoids CORS issues.

Auth options (checked in order):
    RAM_TOKEN            — static bearer token (simplest; expires per Viya policy)
    SAS_CLIENT_ID/SECRET — OAuth client_credentials grant against SASLogon
                           (add SAS_USERNAME/SAS_PASSWORD for the password grant)

Other env vars:
    RAM_API_URL     — base URL, e.g. https://viya.example.com/SASRetrievalAgentManager/api/v1
    SAS_LOGON_URL   — override SASLogon token endpoint (default derived from RAM_API_URL)
    RAM_VERIFY_SSL  — "false" to skip TLS verification (self-signed Viya certs)
    RAM_MOCK        — "true" to run against an in-memory mock (UI demo without Viya)
"""
from __future__ import annotations

import os
import time
import uuid
from typing import Any

import httpx

RAM_API_URL = os.getenv("RAM_API_URL", "").rstrip("/")
VERIFY_SSL = os.getenv("RAM_VERIFY_SSL", "true").lower() != "false"
MOCK = os.getenv("RAM_MOCK", "").lower() == "true"

TIMEOUT = httpx.Timeout(10.0, read=180.0)  # RAM queries can take a while


class RamError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        self.message = message
        super().__init__(message)


# ─── Token management ────────────────────────────────────────────────
_token_cache: dict[str, Any] = {"token": None, "expires_at": 0.0}


def _logon_url() -> str:
    explicit = os.getenv("SAS_LOGON_URL")
    if explicit:
        return explicit
    # Derive https://host/SASLogon/oauth/token from the RAM URL
    base = RAM_API_URL.split("/SASRetrievalAgentManager")[0]
    return f"{base}/SASLogon/oauth/token"


async def _fetch_oauth_token() -> str:
    client_id = os.getenv("SAS_CLIENT_ID")
    client_secret = os.getenv("SAS_CLIENT_SECRET", "")
    username = os.getenv("SAS_USERNAME")
    password = os.getenv("SAS_PASSWORD")
    if not client_id:
        raise RamError(500, "No RAM_TOKEN and no SAS_CLIENT_ID configured — cannot authenticate to SAS Viya.")

    if username and password:
        data = {"grant_type": "password", "username": username, "password": password}
    else:
        data = {"grant_type": "client_credentials"}

    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=TIMEOUT) as client:
        r = await client.post(_logon_url(), data=data, auth=(client_id, client_secret))
    if r.status_code != 200:
        raise RamError(r.status_code, f"SASLogon token request failed: {r.text[:300]}")
    body = r.json()
    _token_cache["token"] = body["access_token"]
    # Refresh a minute before actual expiry
    _token_cache["expires_at"] = time.time() + int(body.get("expires_in", 3600)) - 60
    return _token_cache["token"]


async def _get_token(force_refresh: bool = False) -> str:
    static = os.getenv("RAM_TOKEN")
    if static:
        return static
    if not force_refresh and _token_cache["token"] and time.time() < _token_cache["expires_at"]:
        return _token_cache["token"]
    return await _fetch_oauth_token()


# ─── HTTP helper ─────────────────────────────────────────────────────
async def _request(method: str, path: str, *, params: dict | None = None, json: dict | None = None) -> Any:
    if MOCK:
        return await _mock_request(method, path, params=params, json=json)
    if not RAM_API_URL:
        raise RamError(500, "RAM_API_URL is not configured. Set it in backend/.env (see .env.example).")

    token = await _get_token()
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=TIMEOUT) as client:
        r = await client.request(method, f"{RAM_API_URL}{path}", params=params, json=json,
                                 headers={"Authorization": f"Bearer {token}"})
        # One retry on 401 in case a cached OAuth token just expired
        if r.status_code == 401 and not os.getenv("RAM_TOKEN"):
            token = await _get_token(force_refresh=True)
            r = await client.request(method, f"{RAM_API_URL}{path}", params=params, json=json,
                                     headers={"Authorization": f"Bearer {token}"})
    if r.status_code >= 400:
        try:
            message = r.json().get("message", r.text[:300])
        except Exception:
            message = r.text[:300]
        raise RamError(r.status_code, message)
    return r.json() if r.content else None


# ─── Public API ──────────────────────────────────────────────────────
async def list_agents() -> list[dict]:
    body = await _request("GET", "/agents", params={"limit": 100})
    return body.get("items") or []


async def list_collections() -> list[dict]:
    body = await _request("GET", "/collections", params={"limit": 100})
    return body.get("items") or []


async def list_sessions() -> list[dict]:
    body = await _request("GET", "/querySessions", params={"limit": 100, "sortBy": "updateTimestamp:descending"})
    return body.get("items") or []


async def list_session_queries(session_id: str) -> list[dict]:
    body = await _request("GET", "/query", params={"filter": f"eq(querySessionId,'{session_id}')", "limit": 100})
    items = body.get("items") or []
    return [_normalize_query(q) for q in items]


async def create_query(content: str, *, agent_id: str | None = None,
                       collection_ids: list[str] | None = None,
                       session_id: str | None = None) -> dict:
    payload: dict[str, Any] = {"content": content}
    if agent_id:
        payload["agentId"] = agent_id
    elif collection_ids:
        payload["collectionIds"] = collection_ids
    else:
        raise RamError(400, "Either an agent or at least one collection must be selected.")
    if session_id:
        payload["querySessionId"] = session_id

    body = await _request("POST", "/query", params={"synchronous": "true", "persistent": "true"}, json=payload)
    return _normalize_query(body)


def _normalize_query(q: dict) -> dict:
    """Flatten RAM's queryResponse into the shape the frontend renders."""
    response = q.get("response") or {}
    return {
        "queryId": q.get("id"),
        "querySessionId": q.get("querySessionId"),
        "content": q.get("content"),
        "answer": response.get("answer"),
        "context": response.get("context") or [],
        "toolCalls": response.get("toolCalls") or [],
        "usage": response.get("usageMetadata") or {},
        "target": q.get("target"),
        "targetId": q.get("targetId"),
        "errorCode": q.get("errorCode", 0),
        "errorText": q.get("errorText"),
    }


def status() -> dict:
    if MOCK:
        return {"status": "ok", "mode": "mock", "ramUrl": "(in-memory mock)"}
    auth = "static-token" if os.getenv("RAM_TOKEN") else ("oauth" if os.getenv("SAS_CLIENT_ID") else "unconfigured")
    return {
        "status": "ok" if RAM_API_URL and auth != "unconfigured" else "unconfigured",
        "mode": "live",
        "ramUrl": RAM_API_URL or "(not set)",
        "auth": auth,
    }


# ─── In-memory mock (RAM_MOCK=true) ──────────────────────────────────
# Lets the UI run end-to-end without a reachable Viya environment.
_MOCK_AGENTS = [
    {"id": "a1000000-0000-0000-0000-000000000001", "name": "Weather Agent",
     "description": "Answers questions using the weather data collection."},
    {"id": "a1000000-0000-0000-0000-000000000002", "name": "Policy Agent",
     "description": "Retrieves and summarizes corporate policy documents."},
]
_MOCK_COLLECTIONS = [
    {"id": "c1000000-0000-0000-0000-000000000001", "name": "Weather Collection",
     "description": "Daily weather CSV files."},
    {"id": "c1000000-0000-0000-0000-000000000002", "name": "Policy Documents",
     "description": "HR and travel policy PDFs."},
]
_mock_sessions: dict[str, dict] = {}


async def _mock_request(method: str, path: str, *, params: dict | None = None, json: dict | None = None) -> Any:
    params = params or {}
    if path == "/agents":
        return {"items": _MOCK_AGENTS, "count": len(_MOCK_AGENTS)}
    if path == "/collections":
        return {"items": _MOCK_COLLECTIONS, "count": len(_MOCK_COLLECTIONS)}
    if path == "/querySessions":
        items = sorted(_mock_sessions.values(), key=lambda s: s["updateTimestamp"], reverse=True)
        return {"items": [{k: s[k] for k in ("id", "title", "insertTimestamp", "updateTimestamp")} for s in items],
                "count": len(items)}
    if path == "/query" and method == "GET":
        filt = params.get("filter", "")
        sid = filt.split("'")[1] if "'" in filt else ""
        session = _mock_sessions.get(sid, {"queries": []})
        return {"items": session["queries"], "count": len(session["queries"])}
    if path == "/query" and method == "POST":
        now = time.strftime("%Y-%m-%dT%H:%M:%S+00:00")
        sid = (json or {}).get("querySessionId") or str(uuid.uuid4())
        session = _mock_sessions.setdefault(sid, {
            "id": sid, "title": json["content"][:60], "insertTimestamp": now, "updateTimestamp": now, "queries": [],
        })
        session["updateTimestamp"] = now
        agent_id = (json or {}).get("agentId")
        agent = next((a for a in _MOCK_AGENTS if a["id"] == agent_id), None)
        target_name = agent["name"] if agent else "the selected collections"
        query = {
            "id": str(uuid.uuid4()), "content": json["content"], "errorCode": 0, "errorText": None,
            "origin": "user", "querySessionId": sid,
            "target": "agent" if agent_id else "collection",
            "targetId": {"agentId": agent_id} if agent_id else {"configurationIds": json.get("collectionIds", [])},
            "response": {
                "answer": f"**[Mock response from {target_name}]**\n\nYou asked: _{json['content']}_\n\n"
                          "This is a simulated RAM answer. Point `RAM_API_URL` at a live "
                          "SAS Retrieval Agent Manager deployment and unset `RAM_MOCK` to get real answers.",
                "context": [{
                    "pageContent": "Example retrieved passage that grounded this answer.",
                    "metadata": {"filename": "example_document.pdf", "page": 3},
                }],
                "toolCalls": [{"toolName": "retrieve_documents",
                               "input": {"query": json["content"]},
                               "output": {"documents": 1}}],
                "usageMetadata": {"llmPromptTokens": 220, "llmCompletionTokens": 96,
                                  "llmTotalTokens": 316, "llmTotalCost": 0.0014},
            },
        }
        session["queries"].append(query)
        return query
    raise RamError(404, f"Mock has no handler for {method} {path}")
