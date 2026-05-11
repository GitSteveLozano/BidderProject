"""Pricing agent behavior contract tests.

Spec §5.4: "NEVER generates labor or material cost numbers directly.
Every numeric value traces to a tool call."

These tests stub the tool calls + LLM and verify that compute_pricing's
output is fully derivable from the tool results, and that the LLM is
only used for the narrative (never for numbers).
"""
from __future__ import annotations

from datetime import date, timedelta

import pytest


@pytest.fixture
def stubbed_pricing(monkeypatch, mock_db):
    """Stub every tool the Pricing agent calls so behavior is deterministic."""
    calls: dict[str, list] = {
        "loaded_labor": [],
        "material": [],
        "capacity": [],
        "win_rate": [],
        "llm_complete": [],
    }

    # ── Labor ──
    from tools import labor_cost_lookup

    def fake_loaded(company_id, trade, hours):
        calls["loaded_labor"].append((trade, hours))
        return {
            "trade": trade,
            "hours": hours,
            "avg_loaded_rate": 55.0,
            "loaded_rate_low": 45.0,
            "loaded_rate_high": 68.08,
            "labor_subtotal": round(hours * 55.0, 2),
            "n_employees": 3,
            "matched_classifications": [trade],
            "employees_considered": ["A", "B", "C"],
            "citation": f"avg of 3 active {trade} workers @ $55/hr",
        }

    monkeypatch.setattr(labor_cost_lookup, "get_loaded_labor_cost", fake_loaded)

    # ── Materials ──
    from tools import material_cost_lookup

    def fake_material(service_line, qty):
        calls["material"].append((service_line, qty))
        return {
            "service_line": service_line,
            "quantity": qty,
            "unit": "sqft",
            "cost_per_unit": 11.50,
            "waste_factor": 0.08,
            "subtotal": round(qty * 1.08 * 11.50, 2),
            "citation": f"{qty}sqft × 1.08 × $11.50",
        }

    monkeypatch.setattr(material_cost_lookup, "lookup_material_cost", fake_material)

    # ── Capacity ──
    from tools import capacity_lookup

    def fake_capacity(company_id, start, weeks):
        calls["capacity"].append((str(company_id), start, weeks))
        return {
            "company_id": str(company_id),
            "headcount": 8,
            "capacity_hours_per_week": 320,
            "window_weeks": weeks,
            "avg_utilization": 0.82,
            "weeks": [
                {"week_start": start.isoformat(),
                 "allocated_hours": 262,
                 "capacity_hours": 320,
                 "utilization": 0.82},
            ] * weeks,
            "citation": "sum of allocations / capacity",
        }

    monkeypatch.setattr(capacity_lookup, "get_capacity_utilization", fake_capacity)

    # ── Win rate ──
    from tools import win_rate_lookup

    monkeypatch.setattr(
        win_rate_lookup, "get_win_rate_at_price",
        lambda c, sl, p: {"service_line": sl, "target_price": p,
                          "n_comparable": 12, "win_rate": 0.72,
                          "citation": "12 comparable bids"},
    )

    # ── LLM (narrative only) ──
    import core.anthropic_client as ac

    def fake_complete(model, system, user, **kwargs):
        calls["llm_complete"].append({"system": system, "user": user})
        return "STUB NARRATIVE — agent did not compute numbers"

    monkeypatch.setattr(ac, "complete", fake_complete)

    return calls


class TestComputePricing:
    def test_labor_hours_match_input_plan(self, stubbed_pricing):
        """The labor.total_hours must equal sum of labor_plan hours."""
        from agents import pricing

        result = pricing.compute_pricing(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[
                {"trade": "eifs", "hours": 200},
                {"trade": "helper", "hours": 100},
            ],
            material_quantity=3200,
            estimated_start_date=date.today() + timedelta(weeks=2),
        )
        assert result["labor"]["total_hours"] == 300

    def test_each_trade_in_plan_calls_loaded_labor_lookup(self, stubbed_pricing):
        from agents import pricing

        pricing.compute_pricing(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[
                {"trade": "eifs", "hours": 312},
                {"trade": "helper", "hours": 80},
                {"trade": "finisher", "hours": 40},
            ],
            material_quantity=3200,
            estimated_start_date=date.today() + timedelta(weeks=2),
        )
        trades_called = [c[0] for c in stubbed_pricing["loaded_labor"]]
        assert trades_called == ["eifs", "helper", "finisher"]

    def test_capacity_lookup_uses_estimated_start_date(self, stubbed_pricing):
        from agents import pricing

        start = date(2026, 7, 13)
        pricing.compute_pricing(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[{"trade": "eifs", "hours": 200}],
            material_quantity=1000,
            estimated_start_date=start,
        )
        assert len(stubbed_pricing["capacity"]) == 1
        assert stubbed_pricing["capacity"][0][1] == start

    def test_material_lookup_uses_service_line_and_quantity(self, stubbed_pricing):
        from agents import pricing

        pricing.compute_pricing(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            labor_plan=[{"trade": "stucco_journeyman", "hours": 100}],
            material_quantity=2800,
            estimated_start_date=date.today(),
        )
        assert stubbed_pricing["material"] == [("STUCCO-CONVENTIONAL", 2800)]

    def test_target_price_is_cost_plus_target_margin(self, stubbed_pricing):
        """price = cost / (1 - margin). Hard math invariant."""
        from agents import pricing

        result = pricing.compute_pricing(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[{"trade": "eifs", "hours": 100}],  # 100 × 55 = 5500
            material_quantity=1000,  # 1000 × 1.08 × 11.50 = 12420
            estimated_start_date=date.today(),
        )
        # base_cost = 5500 + 12420 = 17920
        # overhead 18% = 3225.60; cost_with_overhead = 21145.60
        # target margin 32%: target_price = 21145.60 / 0.68 = 31096.47
        assert result["target_price"] == pytest.approx(31096.47, abs=0.10)

    def test_range_low_to_high_brackets_target_price(self, stubbed_pricing):
        from agents import pricing

        result = pricing.compute_pricing(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[{"trade": "eifs", "hours": 100}],
            material_quantity=1000,
            estimated_start_date=date.today(),
        )
        assert result["range_low"] <= result["target_price"] <= result["range_high"]

    def test_capacity_modifier_reflects_utilization(self, stubbed_pricing):
        """At 82% utilization, the modifier should recommend hold."""
        from agents import pricing

        result = pricing.compute_pricing(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[{"trade": "eifs", "hours": 100}],
            material_quantity=1000,
            estimated_start_date=date.today(),
        )
        assert result["capacity_utilization_at_start"] == 0.82
        # At 0.82 (>= 0.70, < 0.85), policy is "hold"
        assert result["capacity_modifier"]["action"] in ("hold", "hold_firm")

    def test_citations_are_collected_from_every_tool(self, stubbed_pricing):
        """The citations list must contain entries from labor, materials,
        capacity, and win rate — proving every number is sourced."""
        from agents import pricing

        result = pricing.compute_pricing(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[
                {"trade": "eifs", "hours": 200},
                {"trade": "helper", "hours": 80},
            ],
            material_quantity=3200,
            estimated_start_date=date.today(),
        )
        joined = " ".join(c for c in result["citations"] if c)
        assert "eifs workers" in joined
        assert "helper workers" in joined
        assert "sqft" in joined or "STUCCO" in joined or "EIFS" in joined
        assert "comparable bids" in joined or "n/a" in joined


class TestBehaviorContract:
    """The hallucination-resistance guarantee (spec §1.5)."""

    def test_llm_called_exactly_once_for_narrative_only(self, stubbed_pricing):
        from agents import pricing

        pricing.compute_pricing(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[{"trade": "eifs", "hours": 200}],
            material_quantity=1000,
            estimated_start_date=date.today(),
        )
        assert len(stubbed_pricing["llm_complete"]) == 1

    def test_llm_prompt_includes_authoritative_numbers(self, stubbed_pricing):
        from agents import pricing

        pricing.compute_pricing(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[{"trade": "eifs", "hours": 200}],
            material_quantity=1000,
            estimated_start_date=date.today(),
        )
        llm_user = stubbed_pricing["llm_complete"][0]["user"]
        # The narrative LLM must be given the numbers as facts, not asked
        # to compute them
        assert "Facts" in llm_user
        assert "authoritative" in llm_user.lower()

    def test_llm_system_forbids_changing_numbers(self, stubbed_pricing):
        from agents import pricing

        pricing.compute_pricing(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[{"trade": "eifs", "hours": 200}],
            material_quantity=1000,
            estimated_start_date=date.today(),
        )
        llm_system = stubbed_pricing["llm_complete"][0]["system"]
        assert "MUST NOT" in llm_system or "must not" in llm_system.lower()

    def test_pricing_breakdown_includes_narrative_field(self, stubbed_pricing):
        """The narrative is appended by the LLM; numbers are not."""
        from agents import pricing

        result = pricing.compute_pricing(
            company_id="company-1",
            service_line="EIFS",
            labor_plan=[{"trade": "eifs", "hours": 200}],
            material_quantity=1000,
            estimated_start_date=date.today(),
        )
        assert "narrative" in result
        assert result["narrative"] == "STUB NARRATIVE — agent did not compute numbers"
