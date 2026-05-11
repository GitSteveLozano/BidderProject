"""Structured logging.

Lightweight stdlib-only structured logger. Each log line is a single JSON
object with a stable shape:

  {"ts": "...", "level": "INFO", "logger": "...", "msg": "...",
   "request_id": "...", "agent_call_id": "...", ...extra...}

A request_id is set per FastAPI request via the middleware in api/main.py.
Agent code can call `log_agent_call("pricing", bid_id=...)` to emit an
agent_call_id that flows into bid_state_history.agent_call_id.
"""
from __future__ import annotations

import contextvars
import json
import logging
import sys
import uuid
from datetime import datetime, timezone
from typing import Any

# Context vars that the formatter reads per log call
_request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "request_id", default=None
)
_agent_call_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "agent_call_id", default=None
)


def set_request_id(rid: str | None = None) -> str:
    rid = rid or str(uuid.uuid4())
    _request_id.set(rid)
    return rid


def set_agent_call_id(aid: str | None = None) -> str:
    aid = aid or str(uuid.uuid4())
    _agent_call_id.set(aid)
    return aid


def current_request_id() -> str | None:
    return _request_id.get()


def current_agent_call_id() -> str | None:
    return _agent_call_id.get()


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if (rid := _request_id.get()) is not None:
            payload["request_id"] = rid
        if (aid := _agent_call_id.get()) is not None:
            payload["agent_call_id"] = aid
        # Merge any structured extras the caller attached
        for key, value in record.__dict__.items():
            if key.startswith("_") or key in {
                "args", "asctime", "created", "exc_info", "exc_text",
                "filename", "funcName", "levelname", "levelno", "lineno",
                "message", "module", "msecs", "msg", "name", "pathname",
                "process", "processName", "relativeCreated", "stack_info",
                "thread", "threadName", "taskName",
            }:
                continue
            payload[key] = value
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


_configured = False


def configure(level: str = "INFO") -> None:
    """Idempotent setup. Call once at process start (FastAPI, Celery, CLI)."""
    global _configured
    if _configured:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    _configured = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
