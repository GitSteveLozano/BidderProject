"""Win rate by price band — used by Pricing agent for narrative rationale.

For repeat_customer segment, win rate at price is mostly schedule-driven
and weakly informative — the recommendation uses capacity primarily. For
cold_bidding segment, win rate at price is load-bearing.
"""
from __future__ import annotations

from uuid import UUID


def get_win_rate_at_price(
    company_id: UUID | str,
    service_line: str,
    target_price: float,
    band_pct: float = 0.10,
) -> dict:
    """Look up historical win rate for similar bids in a ±band_pct window."""
    from core.db import fetch_all

    low = target_price * (1 - band_pct)
    high = target_price * (1 + band_pct)
    rows = fetch_all(
        """
        SELECT outcome, estimated_value, client_segment
        FROM bids
        WHERE company_id = %s
          AND service_line = %s
          AND outcome IN ('WON', 'LOST', 'LOSS', 'STALLED', 'NO_DECISION')
          AND estimated_value BETWEEN %s AND %s
        """,
        (str(company_id), service_line, low, high),
    )
    n = len(rows)
    if n == 0:
        return {
            "service_line": service_line,
            "target_price": target_price,
            "n_comparable": 0,
            "win_rate": None,
            "citation": "no comparable historical bids in ±10% band",
        }
    wins = sum(1 for r in rows if r["outcome"] == "WON")
    return {
        "service_line": service_line,
        "target_price": target_price,
        "n_comparable": n,
        "win_rate": round(wins / n, 3),
        "citation": f"{wins}/{n} won within ±{band_pct:.0%} of target",
    }
