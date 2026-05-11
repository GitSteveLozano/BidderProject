"""Audit log helper.

Append-only record of bid lifecycle mutations. Call `record()` from any
agent or route that changes state. Request ID and agent call ID are
pulled from context vars (core.logging) so callers don't have to thread
them through.

Failures are swallowed and logged — audit must never block a real
operation. (Drop a row vs. drop a customer write.)
"""
from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

logger = logging.getLogger(__name__)


def record(
    *,
    entity_type: str,
    entity_id: str | UUID | None,
    action: str,
    company_id: str | UUID | None = None,
    actor: str = "system",
    diff: dict[str, Any] | None = None,
    notes: str = "",
) -> None:
    """Append a row to audit_log. Swallows errors."""
    try:
        from core.db import execute
        from core.logging import current_agent_call_id, current_request_id

        execute(
            """
            INSERT INTO audit_log (
                entity_type, entity_id, company_id, action, actor,
                request_id, agent_call_id, diff, notes
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                entity_type,
                str(entity_id) if entity_id else None,
                str(company_id) if company_id else None,
                action,
                actor,
                current_request_id(),
                current_agent_call_id(),
                json.dumps(diff, default=str) if diff else None,
                notes,
            ),
        )
    except Exception as e:
        logger.warning("audit_log write failed: %s", e)
