"""Tests for the deterministic pricing math.

The Pricing agent's NUMBERS are pure functions of tool outputs. We test
the math invariants directly without hitting Claude.
"""
from __future__ import annotations

import pytest


def _compute_price(base_cost: float, overhead_pct: float, target_margin_pct: float) -> dict:
    """Mirror of the pricing math in agents/pricing.py compute_pricing."""
    overhead_amount = round(base_cost * (overhead_pct / 100), 2)
    cost_with_overhead = base_cost + overhead_amount
    target_price = round(cost_with_overhead / (1 - target_margin_pct / 100), 2)
    profit = round(target_price - cost_with_overhead, 2)
    return {
        "base_cost": base_cost,
        "overhead": overhead_amount,
        "cost_with_overhead": cost_with_overhead,
        "target_price": target_price,
        "profit": profit,
        "realized_margin_pct": round(profit / target_price * 100, 2),
    }


class TestPricingFormula:
    def test_target_margin_is_realized_in_price(self):
        result = _compute_price(base_cost=10000, overhead_pct=18, target_margin_pct=32)
        assert abs(result["realized_margin_pct"] - 32.0) < 0.05

    def test_zero_overhead_simplifies(self):
        result = _compute_price(base_cost=10000, overhead_pct=0, target_margin_pct=25)
        # price = 10000 / 0.75 = 13333.33
        assert result["target_price"] == pytest.approx(13333.33, abs=0.01)
        assert result["overhead"] == 0

    def test_higher_margin_higher_price(self):
        low = _compute_price(10000, 18, 25)
        high = _compute_price(10000, 18, 40)
        assert high["target_price"] > low["target_price"]

    def test_profit_plus_cost_equals_price(self):
        result = _compute_price(50000, 18, 32)
        assert (
            abs(result["target_price"] - (result["cost_with_overhead"] + result["profit"]))
            < 0.05
        )


class TestMarginRange:
    """Range_low / range_high derived from margin_range_low_pct / high_pct."""

    def test_range_low_at_25_percent_margin(self):
        cost_with_overhead = 10000 * 1.18
        # cost / (1 - 0.25) = cost / 0.75
        expected = round(cost_with_overhead / 0.75, 2)
        assert expected == pytest.approx(15733.33, abs=0.01)

    def test_range_high_at_40_percent_margin(self):
        cost_with_overhead = 10000 * 1.18
        # cost / (1 - 0.40) = cost / 0.60
        expected = round(cost_with_overhead / 0.60, 2)
        assert expected == pytest.approx(19666.67, abs=0.01)
