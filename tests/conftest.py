"""Shared test fixtures.

We don't run a real Postgres in unit tests. Higher-level integration
tests (test_orchestrator_flow.py) mock the DB layer at the call boundary
instead of trying to parse SQL.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def mock_db(monkeypatch):
    """Replace core.db helpers with in-memory recorders.

    Returns a dict with:
      - `records[table]` — list of inserted rows by table heuristic
      - `state` — current bid state (mutable)
      - `transitions` — list of bid_state_history entries
      - `bid_row` — the synthetic bid row returned by fetch_one
      - `set_state(s)` — helper to mutate the bid's state
      - `set_voice(d)`, `set_service_line(d)` — provide mocked profile
    """
    import core.db as core_db

    state = {
        "records": {"bid_state_history": [], "follow_ups": []},
        "bid_state": "RFP_RECEIVED",
        "bid_row": {
            "id": "bid-1",
            "company_id": "company-1",
            "state": "RFP_RECEIVED",
            "service_line": "STUCCO-CONVENTIONAL",
            "client_name": "Test Client",
            "client_segment": "repeat",
            "scope_summary": "Test scope",
            "estimated_start_date": None,
            "job_address": {"formatted": "1 Test Way"},
        },
        "voice": {"tone": "test", "boilerplate_intro": "Test intro"},
        "service_line": {
            "line_name": "STUCCO-CONVENTIONAL",
            "typical_scope_text": "test scope",
            "standard_exclusions": ["Test exclusion 1", "Test exclusion 2"],
        },
        "pricing_logic": {
            "overhead_pct": 18.0,
            "target_margin_pct": 32.0,
            "margin_range_low_pct": 25.0,
            "margin_range_high_pct": 40.0,
            "capacity_discount_behavior": "flex_by_schedule",
        },
    }

    def fetch_one(sql: str, params=None):
        sl = sql.lower().strip()
        if "from bids b join companies c" in sl or "select * from bids where id" in sl:
            return {**state["bid_row"], "state": state["bid_state"]}
        if "select state from bids where id" in sl:
            return {"state": state["bid_state"]}
        if "select client_segment from bids where id" in sl:
            return {"client_segment": state["bid_row"]["client_segment"]}
        if "from voice_patterns where company_id" in sl:
            return state["voice"]
        if "from service_lines where company_id" in sl and "line_name" in sl:
            return state["service_line"]
        if "standard_exclusions" in sl:
            return {"standard_exclusions": state["service_line"]["standard_exclusions"]}
        if "from pricing_logic where company_id" in sl:
            return state["pricing_logic"]
        return None

    def fetch_all(sql: str, params=None):
        return []

    def execute(sql: str, params=None):
        sl = sql.lower().strip()
        if sl.startswith("update bids set state"):
            state["bid_state"] = params[0]
        elif sl.startswith("insert into bid_state_history"):
            state["records"]["bid_state_history"].append(params)
        elif sl.startswith("insert into follow_ups"):
            state["records"]["follow_ups"].append(params)
        elif sl.startswith("insert into bids"):
            state["bid_row"]["id"] = params[0] if len(params) > 0 else state["bid_row"]["id"]
        # Other UPDATEs / INSERTs silently accepted

    monkeypatch.setattr(core_db, "fetch_one", fetch_one)
    monkeypatch.setattr(core_db, "fetch_all", fetch_all)
    monkeypatch.setattr(core_db, "execute", execute)

    return state


@pytest.fixture
def mock_anthropic(monkeypatch):
    """Stub the Anthropic client so agent tests don't hit the API."""
    import core.anthropic_client as ac

    def fake_complete(model, system, user, max_tokens=2048, temperature=0.4):
        # Echo a deterministic stub the orchestrator can consume
        if "rationale" in system.lower() or "narrative" in system.lower():
            return "Stub narrative: target price computed from tool calls."
        if "bid document" in system.lower() or "bid in" in system.lower():
            return _stub_bid_markdown()
        if "follow-up" in system.lower() or "email" in system.lower():
            return "Subject: Following up\n\nHi — checking in. Thanks."
        return "stub response"

    def fake_complete_json(model, system, user, max_tokens=2048, temperature=0.1):
        return {"intent": "create_bid", "confidence": 0.9, "rationale": "stub"}

    monkeypatch.setattr(ac, "complete", fake_complete)
    monkeypatch.setattr(ac, "complete_json", fake_complete_json)
    return ac


def _stub_bid_markdown() -> str:
    return """# Bid for Test Client

## Scope of work
- Three-coat conventional stucco system

## Exclusions
- Test exclusion 1
- Test exclusion 2

## Pricing
Target price: $46,200

Thank you for the opportunity.
"""
