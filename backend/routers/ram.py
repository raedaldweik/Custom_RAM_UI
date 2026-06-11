"""API routes the frontend calls. Thin layer over services.ram."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import ram

router = APIRouter(prefix="/api", tags=["ram"])


class QueryRequest(BaseModel):
    content: str
    agentId: str | None = None
    collectionIds: list[str] | None = None
    querySessionId: str | None = None


def _wrap(coro):
    async def run():
        try:
            return await coro
        except ram.RamError as e:
            raise HTTPException(status_code=e.status if 400 <= e.status < 600 else 502, detail=e.message)
        except Exception as e:  # network errors, DNS, TLS …
            raise HTTPException(status_code=502, detail=f"Could not reach SAS RAM: {e}")
    return run()


@router.get("/health")
def health():
    return ram.status()


@router.get("/agents")
async def agents():
    return await _wrap(ram.list_agents())


@router.get("/collections")
async def collections():
    return await _wrap(ram.list_collections())


@router.get("/sessions")
async def sessions():
    return await _wrap(ram.list_sessions())


@router.get("/sessions/{session_id}/queries")
async def session_queries(session_id: str):
    return await _wrap(ram.list_session_queries(session_id))


@router.post("/query")
async def query(body: QueryRequest):
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Empty query.")
    return await _wrap(ram.create_query(
        body.content,
        agent_id=body.agentId,
        collection_ids=body.collectionIds,
        session_id=body.querySessionId,
    ))
