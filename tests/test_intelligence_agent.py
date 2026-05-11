"""Tests for the Intelligence agent's pattern surfacing logic.

We stub the DB + LLM. The agent's _llm_insight_narrative writes via
core.anthropic_client.complete; we replace that with a deterministic
string so the test asserts on the structural decision (does it write
the insight?), not the narrative content.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def intel_stub(monkeypatch):
    state = {
        "margin_trend": [],
        "open_quotes": [],
        "exclusion_gaps": [],
        "service_line_target_margin": 32.0,
        "capacity_weeks": [],
        "executes": [],
    }

    import core.db as core_db
    from tools import capacity_lookup

    def fetch_one(sql, params=None):
        sl = sql.lower()
        if "from service_lines" in sl and "typical_margin_pct" in sl:
            return {"typical_margin_pct": state["service_line_target_margin"]}
        return None

    def fetch_all(sql, params=None):
        sl = sql.lower()
        if "from job_cost_reconciliation j" in sl and "group by b.service_line" in sl:
            return state["margin_trend"]
        if "state in ('sent'" in sl:
            return state["open_quotes"]
        if "exclusions_missing" in sl and "from bids" in sl:
            return state["exclusion_gaps"]
        return []

    def execute(sql, params=None):
        state["executes"].append((sql.strip().split()[0].upper(), params))

    monkeypatch.setattr(core_db, "fetch_one", fetch_one)
    monkeypatch.setattr(core_db, "fetch_all", fetch_all)
    monkeypatch.setattr(core_db, "execute", execute)
    # Capacity fixture used by the capacity insight
    monkeypatch.setattr(
        capacity_lookup,
        "get_capacity_utilization",
        lambda c, s, weeks: {
            "company_id": str(c),
            "headcount": 8,
            "capacity_hours_per_week": 320,
            "window_weeks": weeks,
            "avg_utilization": state.get("avg_utilization", 0.45),
            "weeks": state["capacity_weeks"] or [
                {"week_start": "2026-05-11", "allocated_hours": 250,
                 "capacity_hours": 320, "utilization": state.get("avg_utilization", 0.45)},
            ],
            "citation": "stub",
        },
    )
    # Stub the LLM narrative so tests don't hit the API
    import core.anthropic_client as ac

    monkeypatch.setattr(ac, "complete", lambda **kwargs: "Stub insight narrative.")
    return state


class TestMarginDriftInsight:
    def test_drift_above_noise_floor_emits_insight(self, intel_stub):
        from agents import intelligence

        intel_stub["margin_trend"] = [
            {
                "service_line": "EIFS",
                "n": 8,
                "avg_margin": 26.0,
                "avg_labor_var": 14.5,
                "bid_ids": ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"],
            }
        ]
        intel_stub["service_line_target_margin"] = 32.0  # drift = -6pp
        generated = intelligence.run_weekly_analysis("company-1")
        margin_insights = [g for g in generated if g["category"] == "margin"]
        assert len(margin_insights) == 1
        assert "EIFS" in margin_insights[0]["headline"]

    def test_drift_below_noise_floor_no_insight(self, intel_stub):
        from agents import intelligence

        intel_stub["margin_trend"] = [
            {
                "service_line": "STUCCO-CONVENTIONAL",
                "n": 12,
                "avg_margin": 33.2,
                "avg_labor_var": 1.2,
                "bid_ids": ["b1"] * 12,
            }
        ]
        intel_stub["service_line_target_margin"] = 32.0  # drift = +1.2pp
        generated = intelligence.run_weekly_analysis("company-1")
        assert not any(g["category"] == "margin" for g in generated)


class TestCapacityInsight:
    def test_high_utilization_with_open_quote_emits_capacity_insight(self, intel_stub):
        from agents import intelligence

        intel_stub["avg_utilization"] = 0.85
        intel_stub["open_quotes"] = [
            {
                "id": "open-bid-1",
                "client_name": "Esprit Heights",
                "service_line": "EIFS",
                "estimated_value": 175000,
                "estimated_start_date": None,
                "estimated_labor_hours": 600,
            }
        ]
        generated = intelligence.run_weekly_analysis("company-1")
        cap = [g for g in generated if g["category"] == "capacity"]
        assert len(cap) == 1
        assert "Hold firm" in cap[0]["headline"] or "175" in cap[0]["headline"]


class TestExclusionsInsight:
    def test_repeated_missing_exclusion_emits_insight(self, intel_stub):
        from agents import intelligence

        intel_stub["exclusion_gaps"] = [
            {
                "service_line": "STUCCO-CONVENTIONAL",
                "exclusions_missing": ["Rough grade should not be above final grade height"],
            }
        ] * 3
        generated = intelligence.run_weekly_analysis("company-1")
        excl = [g for g in generated if g["category"] == "exclusions"]
        assert len(excl) == 1
        assert "STUCCO-CONVENTIONAL" in excl[0]["headline"]


class TestEmptyState:
    def test_no_data_produces_no_insights(self, intel_stub):
        from agents import intelligence

        generated = intelligence.run_weekly_analysis("company-1")
        # Capacity insight may still fire because we provided default capacity_weeks
        # but only if open_quotes is non-empty. Empty → no insights.
        assert generated == []
