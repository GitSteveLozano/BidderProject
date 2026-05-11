"""Job-Cost Reconciliation agent — spec §5.6 NEW v2.

Closes the loop between quoted price and actual delivered cost via
ProService payroll. Updates job_cost_reconciliation + bids tables, then
detects patterns once n>=8 reconciled jobs per service line.
"""
from __future__ import annotations

import json
from uuid import UUID

from core.anthropic_client import complete
from core.db import execute, fetch_all, fetch_one
from core.settings import get_settings
from tools.actual_hours_lookup import get_actual_labor_hours, get_quoted_labor_summary


def reconcile_job(
    bid_id: UUID | str,
    actual_material_cost: float | None = None,
    actual_other_costs: float = 0.0,
) -> dict:
    """Sync reconciliation. Spec §5.6 — runs on JOB_COMPLETE transition.

    Computes delivered_margin_pct, writes job_cost_reconciliation row,
    updates bids.delivered_margin_pct.
    """
    bid_id = str(bid_id)
    quoted = get_quoted_labor_summary(bid_id) or {}
    actuals = get_actual_labor_hours(bid_id)

    bid = fetch_one("SELECT company_id, pricing_breakdown FROM bids WHERE id = %s", (bid_id,))
    if not bid:
        raise ValueError(f"bid {bid_id} not found")
    company_id = bid["company_id"]

    actual_mat = (
        actual_material_cost
        if actual_material_cost is not None
        else float(quoted.get("quoted_material_cost") or 0)
    )
    actual_total = round(
        actuals["total_labor_cost"] + actual_mat + actual_other_costs, 2
    )
    quoted_price = float(quoted.get("quoted_total_price") or 0)
    delivered_margin = (
        round((quoted_price - actual_total) / quoted_price * 100, 2)
        if quoted_price
        else None
    )
    quoted_hours = int(quoted.get("quoted_labor_hours") or 0)
    actual_hours = int(actuals["total_hours"])
    var_hours = (
        round((actual_hours - quoted_hours) / quoted_hours * 100, 2)
        if quoted_hours
        else None
    )
    var_total = (
        round((actual_total - quoted_price) / quoted_price * 100, 2)
        if quoted_price
        else None
    )

    execute(
        """
        INSERT INTO job_cost_reconciliation (
            bid_id, company_id, quoted_price, quoted_labor_hours, quoted_labor_cost,
            quoted_material_cost, quoted_margin_pct,
            actual_labor_hours, actual_labor_cost, actual_material_cost,
            actual_other_costs, delivered_margin_pct,
            variance_labor_hours_pct, variance_total_cost_pct
        ) VALUES (
            %s, %s, %s, %s, %s,
            %s, NULL,
            %s, %s, %s,
            %s, %s,
            %s, %s
        )
        ON CONFLICT (bid_id) DO UPDATE SET
            actual_labor_hours = EXCLUDED.actual_labor_hours,
            actual_labor_cost = EXCLUDED.actual_labor_cost,
            actual_material_cost = EXCLUDED.actual_material_cost,
            actual_other_costs = EXCLUDED.actual_other_costs,
            delivered_margin_pct = EXCLUDED.delivered_margin_pct,
            variance_labor_hours_pct = EXCLUDED.variance_labor_hours_pct,
            variance_total_cost_pct = EXCLUDED.variance_total_cost_pct,
            reconciled_at = NOW()
        """,
        (
            bid_id,
            company_id,
            quoted_price,
            quoted_hours,
            quoted.get("quoted_labor_cost"),
            quoted.get("quoted_material_cost"),
            actual_hours,
            actuals["total_labor_cost"],
            actual_mat,
            actual_other_costs,
            delivered_margin,
            var_hours,
            var_total,
        ),
    )
    execute(
        """
        UPDATE bids
           SET actual_labor_hours = %s,
               actual_cost_total = %s,
               delivered_margin_pct = %s
         WHERE id = %s
        """,
        (actual_hours, actual_total, delivered_margin, bid_id),
    )
    return {
        "bid_id": bid_id,
        "quoted_price": quoted_price,
        "quoted_labor_hours": quoted_hours,
        "actual_labor_hours": actual_hours,
        "actual_total_cost": actual_total,
        "delivered_margin_pct": delivered_margin,
        "variance_labor_hours_pct": var_hours,
        "variance_total_cost_pct": var_total,
    }


def detect_patterns(company_id: UUID | str) -> list[dict]:
    """Nightly batch: detect labor hour variance patterns per service line.

    Spec §5.6: pattern claims require n>=8 completed jobs in a service line.
    """
    company_id = str(company_id)
    rows = fetch_all(
        """
        SELECT b.service_line,
               COUNT(*) AS n,
               AVG(j.variance_labor_hours_pct) AS avg_var_labor,
               AVG(j.variance_total_cost_pct) AS avg_var_cost,
               AVG(j.delivered_margin_pct) AS avg_margin,
               AVG(b.estimated_value)::numeric(12,2) AS avg_quote_value
        FROM job_cost_reconciliation j
        JOIN bids b ON b.id = j.bid_id
        WHERE j.company_id = %s
        GROUP BY b.service_line
        HAVING COUNT(*) >= 8
        """,
        (company_id,),
    )
    patterns = []
    for r in rows:
        sl = r["service_line"]
        avg_var = float(r["avg_var_labor"] or 0)
        if abs(avg_var) >= 5.0:
            patterns.append(
                {
                    "service_line": sl,
                    "n_jobs": int(r["n"]),
                    "avg_labor_variance_pct": round(avg_var, 2),
                    "avg_margin_pct": float(r["avg_margin"] or 0),
                    "recommendation": (
                        f"Consider updating {sl} labor hour formula by "
                        f"{'+' if avg_var > 0 else ''}{round(avg_var, 1)}%"
                    ),
                }
            )
        # Update service_lines.typical_margin_pct rolling average
        execute(
            """
            UPDATE service_lines
               SET typical_margin_pct = %s
             WHERE company_id = %s AND line_name = %s
            """,
            (float(r["avg_margin"] or 0), company_id, sl),
        )
    return patterns


def narrate_reconciliation(reconciliation: dict, bid_summary: dict) -> str:
    """Sonnet narrates the variance story. Numbers come from `reconciliation`."""
    return complete(
        model=get_settings().model_sonnet,
        system=(
            "You narrate a job-cost reconciliation result in 3-5 sentences for a "
            "specialty contractor. Be specific with numbers. DO NOT invent or "
            "modify any figures — quote them verbatim from the input. Mention the "
            "delivered margin and the variance direction. Keep it operational."
        ),
        user=(
            f"Reconciliation facts (authoritative):\n{json.dumps(reconciliation, default=str)}\n\n"
            f"Bid summary:\n{json.dumps(bid_summary, default=str)}\n\nWrite the narrative."
        ),
        max_tokens=512,
        temperature=0.3,
    )
