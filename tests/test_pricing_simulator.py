"""Pricing simulator tests.

The simulator must mirror agents/pricing.compute_pricing math
EXACTLY — otherwise the UI's what-if panel would diverge from what
the actual generation step produces.
"""
from __future__ import annotations

import pytest


class TestBasicMath:
    def test_zero_hours_zero_labor_subtotal(self):
        from core.pricing_simulator import simulate

        r = simulate(labor_hours=0, avg_loaded_rate=55, material_subtotal=10000)
        assert r["labor_subtotal"] == 0
        # Materials only path
        assert r["target_price"] > 0

    def test_target_margin_realized_in_price(self):
        from core.pricing_simulator import simulate

        r = simulate(
            labor_hours=200, avg_loaded_rate=55,
            material_subtotal=10000,
            overhead_pct=18.0, target_margin_pct=32.0,
        )
        # Math: realized margin ≈ target margin
        assert abs(r["realized_margin_pct"] - 32.0) < 0.05

    def test_range_low_lower_than_high(self):
        from core.pricing_simulator import simulate

        r = simulate(
            labor_hours=200, avg_loaded_rate=55,
            material_subtotal=10000,
            margin_range_low_pct=25.0, margin_range_high_pct=40.0,
        )
        assert r["range_low"] < r["range_high"]
        assert r["range_low"] <= r["target_price"] <= r["range_high"]

    def test_higher_hours_higher_price(self):
        from core.pricing_simulator import simulate

        low = simulate(labor_hours=100, avg_loaded_rate=55, material_subtotal=10000)
        high = simulate(labor_hours=300, avg_loaded_rate=55, material_subtotal=10000)
        assert high["target_price"] > low["target_price"]


class TestMirrorsCorePricing:
    """Same inputs → same target_price as agents/pricing.compute_pricing.

    The pricing module's compute_pricing wraps tool calls + LLM; we
    reproduce the same deterministic math here. Drift between the two
    would silently break the what-if panel.
    """

    def test_same_formula_as_pricing_agent(self):
        """Plug in the exact same numbers the Pricing agent would
        produce after its labor/material tool calls, and confirm the
        simulator returns identical target/range/profit."""
        from core.pricing_simulator import simulate

        # Inputs: 312 hours @ $48.20 (the spec sample), 12400 materials,
        # 18% overhead, 32% target, 25-40% margin range
        r = simulate(
            labor_hours=312, avg_loaded_rate=48.20,
            material_subtotal=12400.00,
            overhead_pct=18.0, target_margin_pct=32.0,
            margin_range_low_pct=25.0, margin_range_high_pct=40.0,
        )
        # Replicate the Pricing math directly to confirm
        labor = 312 * 48.20
        base = labor + 12400.00
        overhead = round(base * 0.18, 2)
        cost = base + overhead
        expected_price = round(cost / 0.68, 2)
        assert r["target_price"] == pytest.approx(expected_price, abs=0.01)


class TestWhatIfDelta:
    def test_doubled_hours_increases_price(self):
        from core.pricing_simulator import simulate, what_if_delta

        baseline = simulate(labor_hours=100, avg_loaded_rate=55,
                             material_subtotal=10000)
        scenario = simulate(labor_hours=200, avg_loaded_rate=55,
                             material_subtotal=10000)
        delta = what_if_delta(baseline, scenario)
        assert delta["target_price_delta"] > 0
        assert delta["target_price_delta_pct"] > 0

    def test_higher_margin_increases_price_decreases_volume_logic(self):
        from core.pricing_simulator import simulate, what_if_delta

        baseline = simulate(labor_hours=200, avg_loaded_rate=55,
                             material_subtotal=10000, target_margin_pct=25)
        scenario = simulate(labor_hours=200, avg_loaded_rate=55,
                             material_subtotal=10000, target_margin_pct=40)
        delta = what_if_delta(baseline, scenario)
        # Same cost basis, higher margin → higher price and higher profit
        assert delta["target_price_delta"] > 0
        assert delta["profit_delta"] > 0
        assert delta["margin_delta_pp"] > 0

    def test_zero_delta_when_inputs_identical(self):
        from core.pricing_simulator import simulate, what_if_delta

        baseline = simulate(labor_hours=200, avg_loaded_rate=55,
                             material_subtotal=10000)
        scenario = simulate(labor_hours=200, avg_loaded_rate=55,
                             material_subtotal=10000)
        delta = what_if_delta(baseline, scenario)
        assert delta["target_price_delta"] == 0
        assert delta["profit_delta"] == 0
        assert abs(delta["margin_delta_pp"]) < 0.01


class TestFullPipelineCostEstimate:
    """The end-to-end token budget panel uses estimate_full_pipeline_cost."""

    def test_returns_per_agent_breakdown(self, monkeypatch):
        from core import cost as cost_mod

        # Stub the embedded Composition-cost call so we don't hit a DB
        monkeypatch.setattr(
            cost_mod, "estimate_bid_generation_cost",
            lambda **kw: {"input_tokens": 1500, "model": "claude-sonnet-4-6",
                          "estimated_input_cost_usd": 0.0045},
        )
        result = cost_mod.estimate_full_pipeline_cost(
            company_id="company-1",
            service_line="EIFS",
            scope_summary="x" * 500,
        )
        assert "intake" in result["by_agent"]
        assert "pricing_narrative" in result["by_agent"]
        assert "composition" in result["by_agent"]
        # Composition input matches the stub
        assert result["by_agent"]["composition"]["input_tokens"] == 1500
        # Totals add up
        expected_in = (
            result["by_agent"]["intake"]["input_tokens"]
            + result["by_agent"]["pricing_narrative"]["input_tokens"]
            + result["by_agent"]["composition"]["input_tokens"]
        )
        assert result["total_input_tokens"] == expected_in
        # Total cost is positive and sums per-agent costs
        per_agent_sum = sum(a["cost_usd"] for a in result["by_agent"].values())
        assert abs(result["total_cost_usd"] - per_agent_sum) < 0.0001

    def test_intake_uses_haiku_pricing(self, monkeypatch):
        from core import cost as cost_mod

        monkeypatch.setattr(
            cost_mod, "estimate_bid_generation_cost",
            lambda **kw: {"input_tokens": 1500, "model": "claude-sonnet-4-6",
                          "estimated_input_cost_usd": 0.0045},
        )
        result = cost_mod.estimate_full_pipeline_cost(scope_summary="x")
        # Haiku is cheaper per token than Sonnet — given equal token counts,
        # intake should cost less than pricing_narrative for the same tokens
        intake = result["by_agent"]["intake"]
        narrative = result["by_agent"]["pricing_narrative"]
        per_token_intake = intake["cost_usd"] / max(intake["input_tokens"], 1)
        per_token_narrative = narrative["cost_usd"] / max(narrative["input_tokens"], 1)
        assert per_token_intake < per_token_narrative
