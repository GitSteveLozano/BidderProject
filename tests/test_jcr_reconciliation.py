"""Tests for JCR math.

The reconciliation math is pure: given quoted vs actual, derive variance
percentages and delivered margin.
"""
from __future__ import annotations

import pytest


def _reconcile(
    quoted_price: float,
    quoted_hours: int,
    actual_hours: int,
    actual_labor_cost: float,
    actual_material_cost: float,
    actual_other_costs: float = 0.0,
) -> dict:
    actual_total = actual_labor_cost + actual_material_cost + actual_other_costs
    delivered_margin = round((quoted_price - actual_total) / quoted_price * 100, 2)
    var_hours = round((actual_hours - quoted_hours) / quoted_hours * 100, 2)
    var_total = round((actual_total - quoted_price) / quoted_price * 100, 2)
    return {
        "actual_total": actual_total,
        "delivered_margin_pct": delivered_margin,
        "variance_labor_hours_pct": var_hours,
        "variance_total_cost_pct": var_total,
    }


class TestReconciliationMath:
    def test_perfect_quote(self):
        """When actual == quoted breakdown, margin matches target."""
        # quoted: $100k, 32% margin = $68k cost
        # If actual is $68k: delivered margin = 32%
        result = _reconcile(
            quoted_price=100000, quoted_hours=400,
            actual_hours=400, actual_labor_cost=30000,
            actual_material_cost=38000,
        )
        assert result["delivered_margin_pct"] == pytest.approx(32.0, abs=0.05)
        assert result["variance_labor_hours_pct"] == 0.0

    def test_overrun_reduces_margin(self):
        """+15% labor overrun reduces delivered margin."""
        result = _reconcile(
            quoted_price=100000, quoted_hours=400,
            actual_hours=460, actual_labor_cost=34500,
            actual_material_cost=38000,
        )
        assert result["variance_labor_hours_pct"] == 15.0
        assert result["delivered_margin_pct"] < 32.0
        assert result["delivered_margin_pct"] == pytest.approx(27.5, abs=0.05)

    def test_underrun_improves_margin(self):
        result = _reconcile(
            quoted_price=100000, quoted_hours=400,
            actual_hours=360, actual_labor_cost=27000,
            actual_material_cost=38000,
        )
        assert result["variance_labor_hours_pct"] == -10.0
        assert result["delivered_margin_pct"] > 32.0

    def test_eifs_pattern_runs_hot(self):
        """The seed data deliberately runs EIFS jobs +12-18% over. Validate
        the math computes the expected variance."""
        result = _reconcile(
            quoted_price=175000, quoted_hours=600,
            actual_hours=688, actual_labor_cost=51600,  # 600 * 86 = 51.6k base + 14.7% over
            actual_material_cost=65000,
        )
        assert 10.0 < result["variance_labor_hours_pct"] < 20.0
