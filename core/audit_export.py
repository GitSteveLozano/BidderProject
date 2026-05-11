"""Audit log CSV export.

Shared by the FastAPI route + CLI command + Streamlit download button.
Returns either an iterator of CSV rows or a fully-rendered string,
depending on the caller's needs.
"""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime
from typing import Iterable
from uuid import UUID

CSV_HEADERS = [
    "occurred_at",
    "entity_type",
    "entity_id",
    "company_id",
    "action",
    "actor",
    "request_id",
    "agent_call_id",
    "diff",
    "notes",
]


def fetch_audit_rows(
    company_id: UUID | str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    entity_type: str | None = None,
) -> list[dict]:
    """Pull audit_log rows with optional filters. Newest-first."""
    from core.db import fetch_all

    where = ["1=1"]
    params: list = []
    if company_id is not None:
        where.append("company_id = %s")
        params.append(str(company_id))
    if since is not None:
        where.append("occurred_at >= %s")
        params.append(since)
    if until is not None:
        where.append("occurred_at <= %s")
        params.append(until)
    if entity_type is not None:
        where.append("entity_type = %s")
        params.append(entity_type)
    sql = f"""
        SELECT {', '.join(CSV_HEADERS)}
        FROM audit_log
        WHERE {' AND '.join(where)}
        ORDER BY occurred_at DESC
        LIMIT 10000
    """
    return fetch_all(sql, tuple(params) if params else None)


def render_csv(rows: Iterable[dict]) -> str:
    """Return CSV string with the canonical header."""
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=CSV_HEADERS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        out_row = dict(row)
        # JSONB column → serialized string so CSV is single-line per row
        if isinstance(out_row.get("diff"), dict):
            out_row["diff"] = json.dumps(out_row["diff"], default=str, sort_keys=True)
        if out_row.get("occurred_at") is not None:
            out_row["occurred_at"] = out_row["occurred_at"].isoformat() if hasattr(
                out_row["occurred_at"], "isoformat"
            ) else str(out_row["occurred_at"])
        writer.writerow(out_row)
    return buf.getvalue()


def export_csv(
    company_id: UUID | str | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    entity_type: str | None = None,
) -> str:
    return render_csv(fetch_audit_rows(company_id, since, until, entity_type))
