"""Loaded labor cost lookups.

Spec §1.5 / §5.4: the Pricing agent NEVER generates labor numbers. It calls
get_loaded_labor_cost(trade, hours) which returns real data from the
employees + burden_components tables.
"""
from __future__ import annotations

from uuid import UUID

# Trade -> employee trade_classification candidates, ordered by preference.
TRADE_MATCH: dict[str, list[str]] = {
    "stucco_lead": ["lead_stucco_mech"],
    "stucco_journeyman": ["stucco_journeyman", "lead_stucco_mech"],
    "stucco": ["stucco_journeyman", "lead_stucco_mech", "finisher"],
    "eifs": ["eifs_installer", "stucco_journeyman"],
    "siding_lead": ["siding_lead"],
    "siding": ["siding_installer", "siding_lead"],
    "finisher": ["finisher"],
    "laborer": ["general_laborer"],
    "helper": ["general_laborer"],
}


def _trade_candidates(trade: str) -> list[str]:
    key = (trade or "").strip().lower().replace("-", "_").replace(" ", "_")
    return TRADE_MATCH.get(key, [key])


def get_loaded_labor_cost(
    company_id: UUID | str, trade: str, hours: float
) -> dict:
    """Return loaded cost for `hours` of `trade` work at the average loaded rate.

    The 'loaded' rate already includes burden (FICA, FUTA, SUTA, workers
    comp, PHCA health, TDI, retirement match, PTO, training).
    """
    from core.db import fetch_all

    candidates = _trade_candidates(trade)
    rows = fetch_all(
        """
        SELECT e.id, e.name, e.trade_classification, e.base_hourly_rate,
               b.loaded_hourly_rate, b.total_burden_pct
        FROM employees e
        JOIN burden_components b ON b.employee_id = e.id
        WHERE e.company_id = %s
          AND e.status = 'active'
          AND e.trade_classification = ANY(%s)
        ORDER BY b.effective_date DESC
        """,
        (str(company_id), candidates),
    )
    if not rows:
        return {
            "trade": trade,
            "hours": hours,
            "avg_loaded_rate": None,
            "labor_subtotal": None,
            "n_employees": 0,
            "citation": f"no employees in {candidates} for company",
        }
    rates = [float(r["loaded_hourly_rate"]) for r in rows]
    avg_rate = sum(rates) / len(rates)
    subtotal = round(avg_rate * hours, 2)
    return {
        "trade": trade,
        "matched_classifications": list({r["trade_classification"] for r in rows}),
        "hours": hours,
        "avg_loaded_rate": round(avg_rate, 2),
        "loaded_rate_low": round(min(rates), 2),
        "loaded_rate_high": round(max(rates), 2),
        "labor_subtotal": subtotal,
        "n_employees": len(rows),
        "employees_considered": [r["name"] for r in rows],
        "citation": f"avg of {len(rows)} active {trade} workers' loaded rate",
    }


def get_prevailing_wage(trade: str, county: str = "Honolulu") -> dict | None:
    from core.db import fetch_one

    row = fetch_one(
        """
        SELECT trade, county, basic_hourly, fringe_hourly, total_hourly,
               effective_date, bulletin_number
        FROM prevailing_wages
        WHERE trade = %s AND county = %s
        ORDER BY effective_date DESC
        LIMIT 1
        """,
        (trade, county),
    )
    return row
