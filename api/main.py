"""FastAPI entry point.

Routes are split into modules by domain (companies, bids, intelligence,
documents). The app is intentionally stateless beyond Postgres — auth and
multi-tenancy are out of scope for the PoC per spec §12.6.
"""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from api.routes import bids, companies, documents, intelligence
from core.logging import configure as configure_logging
from core.logging import current_request_id, set_request_id
from core.settings import get_settings

configure_logging(get_settings().log_level)

app = FastAPI(
    title="ProService Bid Intelligence",
    version="0.2.0",
    description="Multi-agent AI platform for SMB specialty contractors.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    """Tag every request with a request_id flowing through structured logs."""
    rid = request.headers.get("X-Request-ID") or set_request_id()
    set_request_id(rid)
    response = await call_next(request)
    response.headers["X-Request-ID"] = current_request_id() or rid
    return response

app.include_router(companies.router, prefix="/companies", tags=["companies"])
app.include_router(documents.router, prefix="/documents", tags=["documents"])
app.include_router(bids.router, prefix="/bids", tags=["bids"])
app.include_router(intelligence.router, prefix="/intelligence", tags=["intelligence"])


@app.get("/")
def health() -> dict:
    return {"status": "ok", "service": "proservice-bid-intelligence"}
