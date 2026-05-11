"""Integration tests for the orchestrator's lifecycle transitions.

These tests don't hit a real DB. The `mock_db` fixture replaces
`core.db.{fetch_one,fetch_all,execute}` with in-memory recorders. The
`mock_anthropic` fixture stubs the LLM client. We assert on the recorded
state machine transitions, which is the part of the orchestrator we
actually want to verify.
"""
from __future__ import annotations

from datetime import date

import pytest

from agents import orchestrator
from core.states import BidState


class TestStateTransitions:
    def test_assessment_with_all_exclusions_present_goes_to_draft(
        self, mock_db, mock_anthropic, monkeypatch
    ):
        """Stub Composition to report all exclusions present →
        DRAFT_GENERATED."""
        from agents import composition

        def fake_compose_bid(**kwargs):
            return {
                "draft_markdown": "stub bid",
                "exclusions_verified": True,
                "exclusions_present": ["Test exclusion 1", "Test exclusion 2"],
                "exclusions_missing": [],
                "total_required": 2,
            }

        def fake_compute_pricing(**kwargs):
            return _stub_pricing()

        from agents import pricing as pricing_mod
        monkeypatch.setattr(composition, "compose_bid", fake_compose_bid)
        monkeypatch.setattr(pricing_mod, "compute_pricing", fake_compute_pricing)

        # Pre-create the bid in the fake state
        mock_db["bid_row"]["id"] = "bid-1"
        mock_db["bid_state"] = "RFP_RECEIVED"

        result = orchestrator.run_assessment(
            bid_id="bid-1",
            labor_plan=[{"trade": "stucco_journeyman", "hours": 312}],
            material_quantity=2800,
        )

        assert result["state"] == "DRAFT_GENERATED"
        assert mock_db["bid_state"] == "DRAFT_GENERATED"
        # Transitions recorded: ASSESSING then DRAFT_GENERATED
        transitions = mock_db["records"]["bid_state_history"]
        to_states = [t[2] for t in transitions]
        assert "ASSESSING" in to_states
        assert "DRAFT_GENERATED" in to_states

    def test_assessment_with_missing_exclusions_goes_to_exclusions_review(
        self, mock_db, mock_anthropic, monkeypatch
    ):
        from agents import composition
        from agents import pricing as pricing_mod

        monkeypatch.setattr(composition, "compose_bid", lambda **kw: {
            "draft_markdown": "stub bid without exclusions",
            "exclusions_verified": False,
            "exclusions_present": ["Test exclusion 1"],
            "exclusions_missing": ["Test exclusion 2"],
            "total_required": 2,
        })
        monkeypatch.setattr(pricing_mod, "compute_pricing", lambda **kw: _stub_pricing())

        mock_db["bid_row"]["id"] = "bid-2"
        mock_db["bid_state"] = "RFP_RECEIVED"

        result = orchestrator.run_assessment(
            bid_id="bid-2",
            labor_plan=[{"trade": "stucco_journeyman", "hours": 312}],
            material_quantity=2800,
        )

        assert result["state"] == "EXCLUSIONS_REVIEW"
        assert mock_db["bid_state"] == "EXCLUSIONS_REVIEW"

    def test_send_bid_transition(self, mock_db, monkeypatch):
        """SENT transition fires follow-up scheduling."""
        from agents import follow_up

        scheduled = []

        def fake_schedule(bid_id, segment):
            scheduled.append((bid_id, segment))
            return []

        monkeypatch.setattr(follow_up, "schedule_follow_ups", fake_schedule)

        mock_db["bid_state"] = "HUMAN_REVIEW"
        orchestrator.send_bid("bid-3")

        assert mock_db["bid_state"] == "SENT"
        assert scheduled == [("bid-3", "repeat")]


class TestOutcomeCapture:
    @pytest.mark.parametrize(
        "outcome,target_state",
        [
            ("WON", "WON"),
            ("LOST", "LOST"),
            ("STALLED", "STALLED"),
            ("NO_DECISION", "NO_DECISION"),
        ],
    )
    def test_outcome_routes_to_correct_state(self, mock_db, outcome, target_state):
        mock_db["bid_state"] = "SENT"
        result = orchestrator.capture_outcome(
            "bid-4", outcome, reason="test", competitor="X",
        )
        assert result["state"] == target_state

    def test_unknown_outcome_raises(self, mock_db):
        mock_db["bid_state"] = "SENT"
        with pytest.raises(ValueError, match="unknown outcome"):
            orchestrator.capture_outcome("bid-5", "MAYBE")


class TestExclusionsReviewPath:
    def test_accept_exclusions_returns_to_draft_generated(self, mock_db):
        mock_db["bid_state"] = "EXCLUSIONS_REVIEW"
        result = orchestrator.accept_exclusions(
            "bid-6",
            accepted=["Test exclusion 2"],
            skipped=[],
        )
        assert result["state"] == "DRAFT_GENERATED"


class TestInvalidTransitions:
    def test_cannot_jump_from_rfp_to_sent(self, mock_db):
        mock_db["bid_state"] = "RFP_RECEIVED"
        with pytest.raises(ValueError, match="invalid transition"):
            orchestrator.transition("bid-7", BidState.SENT, "human")

    def test_cannot_double_transition(self, mock_db):
        """Already in target state → no-op (not error)."""
        mock_db["bid_state"] = "ASSESSING"
        result = orchestrator.transition("bid-8", BidState.ASSESSING)
        assert result.get("noop") is True


# ─── helpers ──────────────────────────────────────────────────


def _stub_pricing() -> dict:
    return {
        "labor": {"by_trade": [], "subtotal": 15038.0, "total_hours": 312, "citations": []},
        "materials": {"subtotal": 12400.0, "citation": "stub"},
        "overhead": {"pct": 18.0, "base": 27438.0, "subtotal": 4938.84},
        "profit": {"subtotal": 14000.0, "target_margin_pct": 32.0},
        "target_price": 46200.0,
        "range_low": 43000.0,
        "range_high": 50000.0,
        "capacity_utilization_at_start": 0.82,
        "capacity_window": [],
        "capacity_modifier": {
            "action": "hold_firm",
            "modifier_pct": 0.0,
            "rationale": "schedule full",
        },
        "win_rate_estimate": {"win_rate": None, "citation": "n/a"},
        "citations": [],
        "narrative": "Stub narrative.",
    }
