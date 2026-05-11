"""Loss postmortem agent tests.

The agent reads bid + competitor + history, calls the LLM with
authoritative facts, and writes an intelligence_insights row.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def postmortem_stub(monkeypatch):
    state = {
        "bid": {
            "id": "bid-loss-1",
            "company_id": "company-1",
            "client_name": "Test Client",
            "service_line": "EIFS",
            "scope_summary": "EIFS package",
            "estimated_value": 100000.0,
            "estimated_labor_hours": 400,
            "capacity_at_quote": 0.55,
            "exclusions_applied": ["A", "B"],
            "exclusions_missing": [],
            "outcome": "LOST",
            "outcome_reason": "price",
            "outcome_competitor": "Inex Plastering",
            "outcome_winning_bid": 88000.0,
            "pricing_breakdown": {},
        },
        "pricing_logic": {
            "target_margin_pct": 32,
            "margin_range_low_pct": 25,
            "margin_range_high_pct": 40,
            "capacity_discount_behavior": "flex_by_schedule",
        },
        "recent_losses": [],
        "llm_response": {
            "likely_reasons": [
                "Our price was 12% above Inex's bid",
                "Capacity at 55% suggests we could have flexed lower",
            ],
            "price_gap_analysis": {
                "interpretation": "Inex priced aggressively below our target margin range",
            },
            "exclusions_signal": "Standard exclusions — no signal",
            "capacity_factor": "Moderate utilization; discount would have been consistent with company behavior",
            "pattern_across_recent_losses": "First LOSS for this service line",
            "recommendations_for_next_bid": [
                "Consider 5-7% discount when capacity < 60% on EIFS bids",
                "Note: Inex is the competitor to beat",
            ],
            "confidence": "low",
        },
        "executes": [],
    }

    import core.anthropic_client as ac
    import core.db as core_db

    def fake_fetch_one(sql, params=None):
        sl = sql.lower()
        if "from bids where id" in sl:
            return state["bid"]
        if "from pricing_logic" in sl:
            return state["pricing_logic"]
        return None

    def fake_fetch_all(sql, params=None):
        if "outcome = 'lost'" in sql.lower() and "id != %s" in sql:
            return state["recent_losses"]
        return []

    def fake_execute(sql, params=None):
        state["executes"].append({"sql": sql, "params": params})

    monkeypatch.setattr(core_db, "fetch_one", fake_fetch_one)
    monkeypatch.setattr(core_db, "fetch_all", fake_fetch_all)
    monkeypatch.setattr(core_db, "execute", fake_execute)
    monkeypatch.setattr(
        ac, "complete_json",
        lambda **kwargs: {**state["llm_response"], "_kwargs": kwargs},
    )
    return state


class TestAnalyzeLoss:
    def test_returns_structured_result(self, postmortem_stub):
        from agents import postmortem

        result = postmortem.analyze_loss("bid-loss-1", write_insight=False)
        assert "likely_reasons" in result
        assert "price_gap_analysis" in result
        assert "recommendations_for_next_bid" in result

    def test_price_gap_pinned_from_facts_not_llm(self, postmortem_stub):
        """The agent must pin our_price, winning_price, delta from the
        DB row, not let the LLM regenerate them. Mutate the LLM's
        response to invent fake numbers and confirm the agent
        overrides them."""
        from agents import postmortem

        postmortem_stub["llm_response"]["price_gap_analysis"] = {
            "our_price": 999999999,  # LLM tries to lie
            "winning_price": 0,
            "delta_usd": 999999999,
            "delta_pct": 9999,
            "interpretation": "lied",
        }
        result = postmortem.analyze_loss("bid-loss-1", write_insight=False)
        pga = result["price_gap_analysis"]
        # Agent pins authoritative numbers
        assert pga["our_price"] == 100000.0
        assert pga["winning_price"] == 88000.0
        assert pga["delta_usd"] == 12000.0
        assert abs(pga["delta_pct"] - 12.0) < 0.01

    def test_writes_intelligence_insight_when_requested(self, postmortem_stub):
        from agents import postmortem

        postmortem.analyze_loss("bid-loss-1", write_insight=True)
        inserts = [
            e for e in postmortem_stub["executes"]
            if "intelligence_insights" in e["sql"].lower()
            and "insert" in e["sql"].lower()
        ]
        assert len(inserts) == 1
        params = inserts[0]["params"]
        # category is 'competitor' (positional in the INSERT)
        # Check the headline contains the client name + service line
        headline = next(p for p in params if isinstance(p, str)
                         and "Test Client" in p)
        assert "EIFS" in headline

    def test_does_not_write_when_disabled(self, postmortem_stub):
        from agents import postmortem

        postmortem.analyze_loss("bid-loss-1", write_insight=False)
        inserts = [
            e for e in postmortem_stub["executes"]
            if "insert into intelligence_insights" in e["sql"].lower()
        ]
        assert inserts == []


class TestGuards:
    def test_raises_on_non_lost_outcome(self, postmortem_stub):
        from agents import postmortem

        postmortem_stub["bid"]["outcome"] = "WON"
        with pytest.raises(ValueError, match="only runs on LOST"):
            postmortem.analyze_loss("bid-loss-1")

    def test_raises_on_missing_bid(self, postmortem_stub):
        from agents import postmortem

        postmortem_stub["bid"] = None
        # Override fetch_one to return None for ANY bid lookup
        import core.db as core_db
        original = core_db.fetch_one
        core_db.fetch_one = lambda sql, params=None: None
        try:
            with pytest.raises(ValueError, match="not found"):
                postmortem.analyze_loss("nonexistent")
        finally:
            core_db.fetch_one = original


class TestNoWinningPriceFallback:
    def test_handles_missing_winning_bid(self, postmortem_stub):
        """LOST without a recorded winning_bid is common — still useful."""
        from agents import postmortem

        postmortem_stub["bid"]["outcome_winning_bid"] = None
        result = postmortem.analyze_loss("bid-loss-1", write_insight=False)
        assert result["price_gap_analysis"]["winning_price"] is None
        assert result["price_gap_analysis"]["delta_usd"] is None


class TestLLMReceivesAuthoritativeFacts:
    def test_user_prompt_contains_competitor_name_and_prices(
        self, postmortem_stub
    ):
        from agents import postmortem

        result = postmortem.analyze_loss("bid-loss-1", write_insight=False)
        user_msg = result["_kwargs"]["user"]
        assert "Inex Plastering" in user_msg
        assert "100000" in user_msg
        assert "88000" in user_msg

    def test_system_prompt_forbids_inventing_numbers(self, postmortem_stub):
        from agents import postmortem

        result = postmortem.analyze_loss("bid-loss-1", write_insight=False)
        system = result["_kwargs"]["system"]
        assert "DO NOT invent numbers" in system or "do not invent" in system.lower()

    def test_company_context_in_system_extra_for_caching(self, postmortem_stub):
        from agents import postmortem

        result = postmortem.analyze_loss("bid-loss-1", write_insight=False)
        kwargs = result["_kwargs"]
        # The system_extra block holds the per-company context for
        # cache_control. Without it, the cache prefix would invalidate
        # on every bid.
        assert kwargs.get("cache_system") is True
        assert kwargs.get("system_extra") is not None
        assert len(kwargs["system_extra"]) >= 1
