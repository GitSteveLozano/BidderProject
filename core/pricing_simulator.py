"""Pure-math pricing simulator.

The same deterministic math the Pricing agent uses, exposed as a side-
effect-free function so the UI can run a slider and recompute margin
without an LLM call or even a DB write.

Mirrors the formula in agents/pricing.compute_pricing — kept in sync
by tests/test_pricing_simulator.py.
"""
from __future__ import annotations


def simulate(
    labor_hours: int,
    avg_loaded_rate: float,
    material_subtotal: float,
    overhead_pct: float = 18.0,
    target_margin_pct: float = 32.0,
    margin_range_low_pct: float = 25.0,
    margin_range_high_pct: float = 40.0,
) -> dict:
    """Return target price + breakdown given inputs.

    Math invariant: price = (labor + materials + overhead) / (1 - margin).
    """
    labor_subtotal = round(labor_hours * avg_loaded_rate, 2)
    base_cost = labor_subtotal + material_subtotal
    overhead_amount = round(base_cost * (overhead_pct / 100), 2)
    cost_with_overhead = base_cost + overhead_amount
    target_price = round(cost_with_overhead / (1 - target_margin_pct / 100), 2)
    profit = round(target_price - cost_with_overhead, 2)
    range_low = round(cost_with_overhead / (1 - margin_range_low_pct / 100), 2)
    range_high = round(cost_with_overhead / (1 - margin_range_high_pct / 100), 2)
    return {
        "labor_subtotal": labor_subtotal,
        "material_subtotal": round(material_subtotal, 2),
        "base_cost": round(base_cost, 2),
        "overhead": overhead_amount,
        "cost_with_overhead": round(cost_with_overhead, 2),
        "profit": profit,
        "target_price": target_price,
        "range_low": range_low,
        "range_high": range_high,
        "realized_margin_pct": round(profit / target_price * 100, 2)
            if target_price else 0.0,
    }


def what_if_delta(baseline: dict, scenario: dict) -> dict:
    """Compute the delta between a baseline and a scenario simulation."""
    return {
        "target_price_delta": round(
            scenario["target_price"] - baseline["target_price"], 2
        ),
        "target_price_delta_pct": round(
            (scenario["target_price"] - baseline["target_price"])
                / baseline["target_price"] * 100, 2
        ) if baseline["target_price"] else 0.0,
        "profit_delta": round(scenario["profit"] - baseline["profit"], 2),
        "margin_delta_pp": round(
            scenario["realized_margin_pct"] - baseline["realized_margin_pct"], 2
        ),
    }
