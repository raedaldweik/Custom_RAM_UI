# SAS RAM Chat UI

A custom chatbot UI for **SAS Retrieval Agent Manager (RAM)**, styled identically to the
Health repository's Population Health AI assistant. Pick a published agent (or query a
collection directly) from the dropdown in the chat header and converse with it — answers,
retrieved source passages, agent tool calls, and token usage all come from the RAM REST API.

## What it does

- **Agent dropdown** — lists every agent published on your RAM environment
  (`GET /agents`), plus collections for direct retrieval queries (`GET /collections`).
- **Conversations with memory** — each chat maps to a RAM *query session*
  (`querySessionId`), so the agent keeps conversational context across turns.
- **Persistent history** — past query sessions are loaded from RAM
  (`GET /querySessions`) into the "Recent conversations" panel and their messages are
  rebuilt on click (`GET /query?filter=eq(querySessionId,'…')`).
- **Grounding transparency** — retrieved context passages render as clickable source
  chips, agent tool calls show in a collapsible trace, and token usage/cost appears
  under each answer.
- **Server-side auth** — the FastAPI backend holds the SAS Viya bearer token (static or
  auto-refreshed via SASLogon OAuth) and proxies all RAM calls, so the token never
  reaches the browser and CORS is a non-issue.

## Architecture

```
Browser (React + Vite + Tailwind — same look as Health repo)
   │  /api/*  (same-origin in prod, Vite proxy in dev)
   ▼
FastAPI backend (token management + thin proxy)
   │  Bearer token
   ▼
SAS Viya — /SASRetrievalAgentManager/api/v1
```

## Quick start (mock mode — no Viya needed)

```bash
# backend
cd backend
pip install -r requirements.txt
RAM_MOCK=true uvicorn main:app --reload --port 8000

# frontend (second terminal)
cd frontend
npm install
npm run dev          # http://localhost:5173, proxies /api to :8000
```

## Connecting to a real RAM deployment

Copy `backend/.env.example` to `backend/.env` and set:

| Variable | Purpose |
|---|---|
| `RAM_API_URL` | `https://<viya-host>/SASRetrievalAgentManager/api/v1` |
| `RAM_TOKEN` | Option A: a static bearer token from SASLogon (quick demos) |
| `SAS_CLIENT_ID` / `SAS_CLIENT_SECRET` | Option B: OAuth client — backend fetches & refreshes tokens itself |
| `SAS_USERNAME` / `SAS_PASSWORD` | Optional: use the password grant to act as a named user |
| `RAM_VERIFY_SSL` | `false` for self-signed Viya certificates |

Getting a quick token for option A:

```bash
curl -k https://<viya-host>/SASLogon/oauth/token \
  -d "grant_type=password&username=<user>&password=<pass>" \
  -u "sas.cli:"
```

## Production

```bash
docker build -t ram-chat-ui .
docker run -p 8000:8000 --env-file backend/.env ram-chat-ui
```

The Dockerfile builds the frontend and serves it from the FastAPI app on one port
(same pattern as the Health repo — works on Railway/Render/Fly out of the box).

## What the RAM API supports (and what it doesn't)

Based on the v1 OpenAPI spec:

**Possible**
- Synchronous Q&A against agents (`POST /query` with `agentId`) or collections (`collectionIds`)
- Multi-turn conversations via `querySessionId`
- Listing/reloading past sessions and their full Q&A history
- Inspecting retrieved context, tool calls, LLM calls, and per-query token usage/cost
- Async queries (`synchronous=false`) — submit then poll `GET /query` by id
- Source/file management (upload files, tags, trigger re-indexing) — API exists, not surfaced in this UI

**Not possible with the current API**
- **Streaming responses** — no SSE/websocket endpoint; answers arrive in one response,
  so the UI shows a typing indicator instead of token-by-token streaming
- Creating/configuring agents, collections, or LLMs (read-only endpoints; manage them in the RAM web app)
- Renaming or deleting query sessions server-side (rename/delete in this UI is local-only)
- Per-message feedback (thumbs up/down) — no feedback endpoint in v1
