"""Actual labor hours per bid — payroll integration stub.

Spec §5.6: JCR agent calls get_actual_labor_hours(bid_id) which in real
deploy hits the ProService payroll API. Here it aggregates the
schedule_allocations table (which the seed script populates with realistic
variance vs. quoted hours for completed jobs).
"""
from __future__ import annotations

from uuid import UUID


def get_actual_labor_hours(bid_id: UUID | str) -> dict:
    from core.db import fetch_all

    rows = fetch_all(
        """
        SELECT sa.employee_id, e.trade_classification, sa.allocated_hours,
               b.loaded_hourly_rate
        FROM schedule_allocations sa
        JOIN employees e ON e.id = sa.employee_id
        LEFT JOIN LATERAL (
            SELECT loaded_hourly_rate
            FROM burden_components
            WHERE employee_id = e.id
            ORDER BY effective_date DESC LIMIT 1
        ) b ON TRUE
        WHERE sa.bid_id = %s
        """,
        (str(bid_id),),
    )
    if not rows:
        return {
            "bid_id": str(bid_id),
            "total_hours": 0,
            "total_labor_cost": 0.0,
            "by_trade": {},
            "citation": "no schedule_allocations for bid",
        }
    by_trade: dict[str, dict] = {}
    total_hours = 0
    total_cost = 0.0
    for r in rows:
        trade = r["trade_classification"]
        hours = int(r["allocated_hours"])
        rate = float(r["loaded_hourly_rate"] or 0)
        cost = hours * rate
        bucket = by_trade.setdefault(
            trade, {"hours": 0, "cost": 0.0, "avg_rate": rate}
        )
        bucket["hours"] += hours
        bucket["cost"] += cost
        total_hours += hours
        total_cost += cost
    return {
        "bid_id": str(bid_id),
        "total_hours": total_hours,
        "total_labor_cost": round(total_cost, 2),
        "by_trade": by_trade,
        "citation": "sum of schedule_allocations rows × loaded_hourly_rate",
    }


def get_quoted_labor_summary(bid_id: UUID | str) -> dict | None:
    """Pull quoted labor breakdown from bids.pricing_breakdown."""
    from core.db import fetch_one

    row = fetch_one(
        "SELECT pricing_breakdown, estimated_labor_hours, estimated_value FROM bids WHERE id = %s",
        (str(bid_id),),
    )
    if not row:
        return None
    pb = row.get("pricing_breakdown") or {}
    labor = pb.get("labor") or {}
    return {
        "quoted_total_price": float(row["estimated_value"] or 0),
        "quoted_labor_hours": int(row["estimated_labor_hours"] or labor.get("total_hours") or 0),
        "quoted_labor_cost": float(labor.get("subtotal") or 0),
        "quoted_material_cost": float((pb.get("materials") or {}).get("subtotal") or 0),
        "quoted_overhead": float((pb.get("overhead") or {}).get("subtotal") or 0),
        "quoted_profit": float((pb.get("profit") or {}).get("subtotal") or 0),
    }
