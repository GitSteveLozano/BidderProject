"""Audit log export route."""
from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response

router = APIRouter()


@router.get("/export.csv")
def export_audit_csv(
    company_id: UUID | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    entity_type: str | None = None,
) -> Response:
    """Stream the audit_log as CSV.

    Query params:
      company_id   — filter to one company
      since/until  — ISO datetime range
      entity_type  — bid | reconciliation | follow_up | ...

    Capped at 10,000 rows; tighten the range to drill deeper.
    """
    from core.audit_export import export_csv

    try:
        body = export_csv(company_id, since, until, entity_type)
    except Exception as e:
        raise HTTPException(500, f"export failed: {e}")

    filename = f"audit-export-{datetime.utcnow():%Y%m%d-%H%M%S}.csv"
    return Response(
        content=body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
