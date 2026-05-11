"""Capacity utilization lookup over schedule_allocations.

Spec §5.4 NEW v2: Pricing agent calls get_capacity_utilization(weeks) to
calibrate price recommendations against forward schedule.
"""
from __future__ import annotations

from datetime import date, timedelta
from uuid import UUID

# Hawaii standard: 5-day, 8-hour work week.
HOURS_PER_EMPLOYEE_WEEK = 40


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def get_active_headcount(company_id: UUID | str) -> int:
    from core.db import fetch_one

    row = fetch_one(
        "SELECT COUNT(*) AS n FROM employees WHERE company_id = %s AND status = 'active'",
        (str(company_id),),
    )
    return int(row["n"]) if row else 0


def get_capacity_utilization(
    company_id: UUID | str, start_date: date, weeks: int = 8
) -> dict:
    """Return per-week utilization for the given company over `weeks` weeks
    starting at the Monday of `start_date`.
    """
    from core.db import fetch_all

    headcount = get_active_headcount(company_id)
    capacity_hours = headcount * HOURS_PER_EMPLOYEE_WEEK
    if capacity_hours == 0:
        return {
            "company_id": str(company_id),
            "headcount": 0,
            "weeks": [],
            "citation": "no active employees",
        }
    first_monday = _monday(start_date)
    last_monday = first_monday + timedelta(weeks=weeks - 1)
    rows = fetch_all(
        """
        SELECT week_start_date, SUM(allocated_hours) AS allocated_hours
        FROM schedule_allocations
        WHERE company_id = %s
          AND week_start_date BETWEEN %s AND %s
        GROUP BY week_start_date
        ORDER BY week_start_date
        """,
        (str(company_id), first_monday, last_monday),
    )
    allocated_by_week = {r["week_start_date"]: int(r["allocated_hours"]) for r in rows}
    out_weeks = []
    for i in range(weeks):
        wk = first_monday + timedelta(weeks=i)
        alloc = allocated_by_week.get(wk, 0)
        util = round(alloc / capacity_hours, 3)
        out_weeks.append(
            {
                "week_start": wk.isoformat(),
                "allocated_hours": alloc,
                "capacity_hours": capacity_hours,
                "utilization": util,
            }
        )
    avg_util = (
        round(sum(w["utilization"] for w in out_weeks) / len(out_weeks), 3)
        if out_weeks
        else 0.0
    )
    return {
        "company_id": str(company_id),
        "headcount": headcount,
        "capacity_hours_per_week": capacity_hours,
        "window_weeks": weeks,
        "avg_utilization": avg_util,
        "weeks": out_weeks,
        "citation": f"sum of allocated hours / ({headcount} workers × 40h/wk)",
    }


def capacity_modifier(utilization: float, behavior: str = "flex_by_schedule") -> dict:
    """Translate utilization into a pricing recommendation.

    Cavy's pattern (spec §3.2): discount to fill schedule when slow, hold
    firm when full. Modifier here is a recommendation to the human, not an
    automated price adjustment.
    """
    if behavior == "fixed":
        return {"action": "hold", "modifier_pct": 0.0, "rationale": "fixed pricing"}
    if utilization >= 0.85:
        return {
            "action": "hold_firm",
            "modifier_pct": 0.0,
            "rationale": "schedule is full; hold target price",
        }
    if utilization >= 0.70:
        return {
            "action": "hold",
            "modifier_pct": 0.0,
            "rationale": "healthy utilization; price at target",
        }
    if utilization >= 0.50:
        return {
            "action": "consider_small_discount",
            "modifier_pct": -2.5,
            "rationale": "moderate utilization; minor discount to win work may be worth it",
        }
    return {
        "action": "consider_discount",
        "modifier_pct": -5.0,
        "rationale": "low utilization; discount to fill schedule is consistent with company behavior",
    }
