"""Intelligence dashboard routes."""
from __future__ import annotations

from datetime import date
from uuid import UUID

from fastapi import APIRouter

from agents import intelligence
from core.db import fetch_all
from tools.capacity_lookup import get_capacity_utilization

router = APIRouter()


@router.get("/{company_id}/insights")
def get_insights(company_id: UUID, status: str = "open", limit: int = 10) -> list[dict]:
    return fetch_all(
        """
        SELECT id, category, severity, headline, finding, recommendation,
               projected_impact, supporting_bids, generated_at, status
        FROM intelligence_insights
        WHERE company_id = %s AND status = %s
        ORDER BY generated_at DESC
        LIMIT %s
        """,
        (str(company_id), status, limit),
    )


@router.post("/{company_id}/run")
def run_analysis(company_id: UUID) -> dict:
    generated = intelligence.run_weekly_analysis(company_id)
    return {"generated": generated, "count": len(generated)}


@router.get("/{company_id}/capacity")
def capacity(company_id: UUID, weeks: int = 8) -> dict:
    return get_capacity_utilization(company_id, date.today(), weeks=weeks)


@router.get("/{company_id}/margin-by-service-line")
def margin_by_service_line(company_id: UUID) -> list[dict]:
    return fetch_all(
        """
        SELECT b.service_line,
               COUNT(*) AS n_completed,
               AVG(j.delivered_margin_pct) AS avg_margin_pct,
               AVG(j.variance_labor_hours_pct) AS avg_labor_var,
               AVG(j.variance_total_cost_pct) AS avg_cost_var
        FROM job_cost_reconciliation j
        JOIN bids b ON b.id = j.bid_id
        WHERE j.company_id = %s
        GROUP BY b.service_line
        ORDER BY b.service_line
        """,
        (str(company_id),),
    )
