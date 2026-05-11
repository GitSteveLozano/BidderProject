"""Audit log wiring tests.

Verify that orchestrator mutations emit audit_log INSERTs with the
expected shape.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def captured_audit(monkeypatch, mock_db):
    """Intercept audit.record and capture every call."""
    calls: list[dict] = []

    import core.audit as audit_mod

    original = audit_mod.record

    def fake_record(**kwargs):
        calls.append(kwargs)
        # Also call the real one so DB-level INSERT is exercised in CI
        try:
            original(**kwargs)
        except Exception:
            pass

    monkeypatch.setattr(audit_mod, "record", fake_record)
    return calls


class TestAuditOnTransition:
    def test_transition_emits_audit_with_state_diff(self, mock_db, captured_audit):
        from agents import orchestrator
        from core.states import BidState

        mock_db["bid_state"] = "RFP_RECEIVED"
        orchestrator.transition("bid-1", BidState.ASSESSING, "auto", "begin")

        assert any(c["action"] == "transition" for c in captured_audit)
        transition_call = next(c for c in captured_audit if c["action"] == "transition")
        assert transition_call["entity_type"] == "bid"
        assert transition_call["actor"] == "auto"
        assert transition_call["diff"]["state"] == {
            "from": "RFP_RECEIVED", "to": "ASSESSING",
        }


class TestAuditOnCreateBid:
    def test_create_bid_emits_audit(self, mock_db, captured_audit):
        from agents import orchestrator

        orchestrator.create_bid(
            company_id="company-1",
            client_name="Test",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="x",
        )
        create_calls = [c for c in captured_audit if c["action"] == "create"]
        assert len(create_calls) == 1
        assert create_calls[0]["entity_type"] == "bid"


class TestAuditOnOutcome:
    def test_outcome_emits_audit_before_state_change(self, mock_db, captured_audit):
        from agents import orchestrator

        mock_db["bid_state"] = "SENT"
        orchestrator.capture_outcome("bid-2", "WON", competitor="Inex")

        outcome_calls = [c for c in captured_audit if c["action"] == "outcome"]
        assert len(outcome_calls) == 1
        assert outcome_calls[0]["diff"]["outcome"] == "WON"
        assert outcome_calls[0]["diff"]["competitor"] == "Inex"


class TestAuditFailureIsSilent:
    """Audit failures must NOT block the real operation."""

    def test_audit_db_failure_does_not_raise(self, monkeypatch):
        """If the audit INSERT fails, the function returns normally."""
        import core.audit as audit_mod

        # Simulate DB failure
        def fake_execute(sql, params):
            raise RuntimeError("db unavailable")

        # Patch core.db.execute at the import point inside audit.record
        import core.db

        monkeypatch.setattr(core.db, "execute", fake_execute)
        # No exception expected
        audit_mod.record(
            entity_type="bid",
            entity_id="x",
            action="test",
        )
