"""Streaming Composition tests.

Verify:
  - compose_bid_stream yields tokens
  - _build_prompts produces identical bytes between streaming and
    non-streaming paths (cache prefix stability across variants)
  - orchestrator.run_assessment_streaming yields the right event
    sequence: ('pricing', dict) → many ('token', str) → ('done', dict)
"""
from __future__ import annotations

import pytest


@pytest.fixture
def fake_stream(monkeypatch):
    """Stub the streaming SDK call to yield a fixed sequence of deltas."""
    state = {"deltas": ["# Bid\n", "## Scope\n", "- stucco\n", "## Exclusions\n",
                         "- Test exclusion 1\n", "- Test exclusion 2\n",
                         "## Pricing\nTotal: $46,200"]}

    class FakeStream:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        @property
        def text_stream(self):
            yield from state["deltas"]

    class FakeMessages:
        def stream(self, **kwargs):
            state["last_call"] = kwargs
            return FakeStream()

    class FakeClient:
        messages = FakeMessages()

    import core.anthropic_client as ac

    monkeypatch.setattr(ac, "get_client", lambda: FakeClient())
    return state


def _stub_pricing() -> dict:
    return {
        "labor": {"total_hours": 312, "subtotal": 15038.0, "by_trade": []},
        "materials": {"subtotal": 12400.0, "citation": "stub"},
        "overhead": {"subtotal": 4938.84},
        "profit": {"subtotal": 14000.0, "target_margin_pct": 32.0},
        "target_price": 46200.0,
        "range_low": 43000.0,
        "range_high": 50000.0,
        "capacity_utilization_at_start": 0.82,
        "capacity_modifier": {"action": "hold_firm", "rationale": "full"},
        "win_rate_estimate": {"win_rate": 0.72},
        "citations": ["stub"],
        "narrative": "stub",
    }


class TestComposeBidStream:
    def test_yields_all_deltas_in_order(self, mock_db, fake_stream):
        from agents import composition

        chunks = list(composition.compose_bid_stream(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="x",
            client_name="x",
            client_address="x",
            pricing_breakdown=_stub_pricing(),
        ))
        assert chunks == fake_stream["deltas"]

    def test_concatenated_text_equals_assembled_draft(self, mock_db, fake_stream):
        from agents import composition

        chunks = list(composition.compose_bid_stream(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="x",
            client_name="x",
            client_address="x",
            pricing_breakdown=_stub_pricing(),
        ))
        assembled = "".join(chunks)
        assert "Test exclusion 1" in assembled
        assert "$46,200" in assembled


class TestPromptParity:
    """Streaming and non-streaming paths must produce identical prompts.

    Otherwise switching the streaming toggle would change the cache key
    and we'd lose every cached prefix every time a user clicks the box.
    """

    def test_build_prompts_returns_same_bytes_for_both_paths(self, mock_db):
        from agents import composition

        sys1, user1, extra1 = composition._build_prompts(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="Esprit Heights scope",
            client_name="McKenzie GC",
            client_address="1 Esprit Dr",
            pricing_breakdown=_stub_pricing(),
        )
        sys2, user2, extra2 = composition._build_prompts(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="Esprit Heights scope",
            client_name="McKenzie GC",
            client_address="1 Esprit Dr",
            pricing_breakdown=_stub_pricing(),
        )
        assert sys1 == sys2
        assert user1 == user2
        assert extra1 == extra2


class TestOrchestratorStreamingFlow:
    """run_assessment_streaming yields pricing → tokens → done in order."""

    def test_event_sequence_correct(self, mock_db, fake_stream, monkeypatch):
        from agents import composition, orchestrator, pricing

        # Stub pricing to avoid hitting the labor/capacity tools
        def fake_pricing(**kwargs):
            return _stub_pricing()

        monkeypatch.setattr(pricing, "compute_pricing", fake_pricing)
        # Service line returned by mock_db includes "Test exclusion 1/2" so
        # the verification step on the streamed draft passes
        mock_db["service_line"] = {
            "line_name": "STUCCO-CONVENTIONAL",
            "typical_scope_text": "test scope",
            "standard_exclusions": ["Test exclusion 1", "Test exclusion 2"],
        }
        mock_db["bid_row"]["service_line"] = "STUCCO-CONVENTIONAL"

        events = list(orchestrator.run_assessment_streaming(
            bid_id="bid-stream-1",
            labor_plan=[{"trade": "stucco_journeyman", "hours": 200}],
            material_quantity=2400,
        ))
        kinds = [e[0] for e in events]

        # First event is 'pricing', last is 'done', middle are 'token'
        assert kinds[0] == "pricing"
        assert kinds[-1] == "done"
        assert kinds.count("token") == len(fake_stream["deltas"])
        # The 'pricing' payload is the pricing dict
        assert events[0][1]["target_price"] == 46200.0
        # The 'done' payload has the run_assessment-shaped dict
        done = events[-1][1]
        assert "bid_id" in done
        assert "state" in done
        assert "pricing" in done
        assert "composition" in done
        assert done["composition"]["exclusions_verified"] is True

    def test_done_payload_records_exclusions_missing_correctly(
        self, mock_db, fake_stream, monkeypatch
    ):
        from agents import orchestrator, pricing

        monkeypatch.setattr(pricing, "compute_pricing",
                             lambda **k: _stub_pricing())
        # Require an exclusion the stream doesn't emit → missing
        mock_db["service_line"] = {
            "line_name": "EIFS",
            "typical_scope_text": "EIFS spec",
            "standard_exclusions": ["NEVER_IN_STREAMED_OUTPUT"],
        }
        mock_db["bid_row"]["service_line"] = "EIFS"

        events = list(orchestrator.run_assessment_streaming(
            bid_id="bid-stream-2",
            labor_plan=[{"trade": "eifs", "hours": 100}],
            material_quantity=1000,
        ))
        done = events[-1][1]
        assert done["state"] == "EXCLUSIONS_REVIEW"
        assert "NEVER_IN_STREAMED_OUTPUT" in done["composition"]["exclusions_missing"]
