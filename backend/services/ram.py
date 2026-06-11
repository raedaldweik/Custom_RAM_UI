"""
SAS Retrieval Agent Manager (RAM) client.

Wraps the RAM REST API (OpenAPI v1) and handles SAS Viya authentication.
The browser never talks to RAM directly — this backend proxies every call,
which keeps the bearer token server-side and avoids CORS issues.

Auth options (checked in order):
    RAM_TOKEN            — static bearer token (simplest; expires per policy)
    SAS_CLIENT_ID/SECRET — OAuth client_credentials grant
                           (add SAS_USERNAME/SAS_PASSWORD for the password grant)
    device code flow     — default for standalone RAM (Keycloak): no configuration
                           needed; the UI's "Sign in" button drives the flow against
                           the pre-configured public client (RAM_CLIENT_ID, default
                           "sas-ram-api") with PKCE, and the backend keeps the
                           session alive with the refresh token.

Other env vars:
    RAM_API_URL     — base URL, e.g. https://host/SASRetrievalAgentManager/api/v1
    SAS_LOGON_URL   — override the OAuth token endpoint (default derived from RAM_API_URL)
    RAM_CLIENT_ID   — public client for the device flow (default "sas-ram-api")
    RAM_REALM       — Keycloak realm for standalone RAM (default "sas-iot")
    RAM_VERIFY_SSL  — "false" to skip TLS verification (self-signed certs)
    RAM_MOCK        — "true" to run against an in-memory mock (UI demo without RAM)
"""
from __future__ import annotations

import base64
import hashlib
import os
import secrets
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
_token_cache: dict[str, Any] = {"token": None, "expires_at": 0.0, "refresh_token": None}
_device_state: dict[str, str] = {}  # in-flight device authorization (verifier + device_code)


def _oidc_base() -> str:
    """Keycloak OpenID Connect base for standalone RAM, e.g.
    https://host/SASRetrievalAgentManager/auth/realms/sas-iot/protocol/openid-connect"""
    explicit = os.getenv("SAS_LOGON_URL")
    if explicit and "/protocol/openid-connect" in explicit:
        return explicit.split("/protocol/openid-connect")[0] + "/protocol/openid-connect"
    base = RAM_API_URL.split("/api/")[0]  # strip /api/v1
    realm = os.getenv("RAM_REALM", "sas-iot")
    return f"{base}/auth/realms/{realm}/protocol/openid-connect"


def _logon_url() -> str:
    explicit = os.getenv("SAS_LOGON_URL")
    if explicit:
        return explicit
    # Derive https://host/SASLogon/oauth/token from the RAM URL (full Viya);
    # standalone RAM deployments go through _oidc_base() instead.
    base = RAM_API_URL.split("/SASRetrievalAgentManager")[0]
    return f"{base}/SASLogon/oauth/token"


def _store_tokens(body: dict, *, token_url: str | None = None,
                  client_id: str | None = None, auth_style: str = "body") -> None:
    _token_cache["token"] = body["access_token"]
    # Refresh shortly before actual expiry
    _token_cache["expires_at"] = time.time() + int(body.get("expires_in", 300)) - 30
    if body.get("refresh_token"):
        _token_cache["refresh_token"] = body["refresh_token"]
    if token_url:
        _token_cache["token_url"] = token_url
        _token_cache["client_id"] = client_id
        _token_cache["auth_style"] = auth_style  # "basic" (UAA/SASLogon) or "body" (Keycloak public)


# ─── Sign-in flow detection ──────────────────────────────────────────
# Standalone RAM ships Keycloak (device code flow); full SAS Viya uses
# SASLogon (authorization code flow with the sas.cli public client).
_flow_cache: dict[str, str | None] = {"flow": None}


def _viya_logon_base() -> str:
    explicit = os.getenv("SAS_LOGON_URL")
    if explicit:
        return explicit.split("/oauth/")[0]
    return RAM_API_URL.split("/SASRetrievalAgentManager")[0] + "/SASLogon"


async def detect_signin_flow() -> str:
    """Return "device" (Keycloak) or "code" (Viya SASLogon paste-the-code)."""
    env = os.getenv("RAM_AUTH_FLOW")
    if env in ("device", "code"):
        return env
    if _flow_cache["flow"]:
        return _flow_cache["flow"]
    if not RAM_API_URL:
        return "device"
    realm = os.getenv("RAM_REALM", "sas-iot")
    base = RAM_API_URL.split("/api/")[0]
    try:
        async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=httpx.Timeout(8.0)) as client:
            r = await client.get(f"{base}/auth/realms/{realm}/.well-known/openid-configuration")
        _flow_cache["flow"] = "device" if r.status_code == 200 else "code"
    except Exception:
        return "device"  # don't cache on network errors — retry next time
    return _flow_cache["flow"]


# ─── Viya SASLogon authorization code flow (sas.cli public client) ───
# Visiting /SASLogon/oauth/authorize?client_id=sas.cli&response_type=code
# displays an authorization code after login (SSO included); the user
# pastes it into the UI and we exchange it for tokens here.
def viya_authorize_url() -> str:
    client_id = os.getenv("SAS_AUTH_CLIENT_ID", "sas.cli")
    return f"{_viya_logon_base()}/oauth/authorize?client_id={client_id}&response_type=code"


async def viya_code_exchange(code: str) -> dict:
    client_id = os.getenv("SAS_AUTH_CLIENT_ID", "sas.cli")
    client_secret = os.getenv("SAS_AUTH_CLIENT_SECRET", "")
    token_url = f"{_viya_logon_base()}/oauth/token"
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=TIMEOUT) as client:
        r = await client.post(token_url,
                              data={"grant_type": "authorization_code", "code": code.strip()},
                              auth=(client_id, client_secret))
    if r.status_code != 200:
        raise RamError(r.status_code, f"Sign-in failed — SASLogon said: {r.text[:300]}")
    _store_tokens(r.json(), token_url=token_url, client_id=client_id, auth_style="basic")
    return {"ok": True}


# ─── Device code flow (standalone RAM / Keycloak public client) ──────
async def device_start() -> dict:
    """Begin a device authorization (PKCE). Returns the code/URL the user needs."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("utf-8").rstrip("=")
    digest = hashlib.sha256(verifier.encode("utf-8")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode("utf-8").rstrip("=")

    client_id = os.getenv("RAM_CLIENT_ID", "sas-ram-api")
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=TIMEOUT) as client:
        r = await client.post(f"{_oidc_base()}/auth/device", data={
            "client_id": client_id,
            "scope": "openid",
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        })
    if r.status_code != 200:
        raise RamError(r.status_code, f"Device authorization failed: {r.text[:300]}")
    body = r.json()
    _device_state.update({"verifier": verifier, "device_code": body["device_code"]})
    return {
        "userCode": body.get("user_code"),
        "verificationUri": body.get("verification_uri"),
        "verificationUriComplete": body.get("verification_uri_complete"),
        "expiresIn": body.get("expires_in"),
        "interval": body.get("interval", 5),
    }


async def device_poll() -> dict:
    """Poll Keycloak until the user approves the device authorization."""
    if not _device_state.get("device_code"):
        raise RamError(400, "No device authorization in progress — start a sign-in first.")
    client_id = os.getenv("RAM_CLIENT_ID", "sas-ram-api")
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=TIMEOUT) as client:
        r = await client.post(f"{_oidc_base()}/token", data={
            "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
            "device_code": _device_state["device_code"],
            "code_verifier": _device_state["verifier"],
            "client_id": client_id,
        })
    try:
        body = r.json()
    except Exception:
        raise RamError(r.status_code, r.text[:300])
    if r.status_code != 200:
        error = body.get("error", "")
        if error in ("authorization_pending", "slow_down"):
            return {"pending": True, "slowDown": error == "slow_down"}
        _device_state.clear()
        raise RamError(r.status_code, body.get("error_description") or error or r.text[:300])
    _store_tokens(body, token_url=f"{_oidc_base()}/token", client_id=client_id, auth_style="body")
    _device_state.clear()
    return {"ok": True}


async def _refresh_token_grant() -> str | None:
    """Renew the access token with the stored refresh token (any sign-in flow)."""
    refresh = _token_cache.get("refresh_token")
    token_url = _token_cache.get("token_url")
    if not refresh or not token_url:
        return None
    client_id = _token_cache.get("client_id") or os.getenv("RAM_CLIENT_ID", "sas-ram-api")
    data = {"grant_type": "refresh_token", "refresh_token": refresh}
    auth = None
    if _token_cache.get("auth_style") == "basic":
        auth = (client_id, os.getenv("SAS_AUTH_CLIENT_SECRET", ""))
    else:
        data["client_id"] = client_id
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=TIMEOUT) as client:
        r = await client.post(token_url, data=data, auth=auth)
    if r.status_code != 200:
        # Refresh token expired/revoked — user must sign in again
        _token_cache["refresh_token"] = None
        return None
    _store_tokens(r.json())
    return _token_cache["token"]


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

    # SASLogon (UAA) wants client auth via HTTP Basic (empty secret is fine for
    # public clients like sas.cli); Keycloak public clients want client_id in
    # the form body. Try Basic first, fall back to the body style.
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=TIMEOUT) as client:
        r = await client.post(_logon_url(), data=data, auth=(client_id, client_secret))
        if r.status_code in (400, 401) and not client_secret:
            r = await client.post(_logon_url(), data={**data, "client_id": client_id})
    if r.status_code != 200:
        raise RamError(r.status_code, f"Token request failed: {r.text[:300]}")
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
    refreshed = await _refresh_token_grant()
    if refreshed:
        return refreshed
    if os.getenv("SAS_CLIENT_ID"):
        return await _fetch_oauth_token()
    raise RamError(401, "Not signed in — click “Sign in” in the header to authenticate with RAM.")


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
        return {"status": "ok", "mode": "mock", "ramUrl": "(in-memory mock)", "authenticated": True}
    if os.getenv("RAM_TOKEN"):
        auth, authenticated = "static-token", True
    elif os.getenv("SAS_CLIENT_ID"):
        auth, authenticated = "oauth", True
    else:
        # Standalone RAM: device sign-in through the UI
        auth = "device"
        authenticated = bool(
            _token_cache.get("refresh_token")
            or (_token_cache["token"] and time.time() < _token_cache["expires_at"])
        )
    if not RAM_API_URL:
        state = "unconfigured"
    elif auth == "device" and not authenticated:
        state = "signin_required"
    else:
        state = "ok"
    return {
        "status": state,
        "mode": "live",
        "ramUrl": RAM_API_URL or "(not set)",
        "auth": auth,
        "authenticated": authenticated,
    }


async def status_async() -> dict:
    """status() plus the interactive sign-in flow ("device" or "code")."""
    s = status()
    if s.get("auth") == "device":
        s["signinFlow"] = await detect_signin_flow()
        if s["signinFlow"] == "code":
            s["authorizeUrl"] = viya_authorize_url() if RAM_API_URL else None
    return s


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
