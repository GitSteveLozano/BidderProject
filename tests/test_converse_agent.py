"""Conversational agent tests.

Verify the converse agent:
  - loads bid facts into the system prompt
  - calls the compaction-beta endpoint when enabled
  - preserves response.content (full blocks) in the next turn — silent
    corruption if we only kept .text
  - falls back cleanly when compaction is disabled
"""
from __future__ import annotations

from uuid import uuid4

import pytest


@pytest.fixture
def converse_stub(monkeypatch):
    state = {
        "bid": {
            "id": "bid-1",
            "company_id": "company-1",
            "client_name": "Esprit Heights",
            "service_line": "EIFS",
            "scope_summary": "EIFS package — Esprit Heights",
            "estimated_value": 99329.80,
            "estimated_labor_hours": 392,
            "state": "RECONCILED",
            "capacity_at_quote": 0.82,
            "exclusions_applied": ["Sheet metal flashings"],
            "exclusions_missing": [],
            "outcome": "WON",
            "delivered_margin_pct": 26.4,
            "pricing_breakdown": {"target_price": 99329.80},
            "company_name": "Honolulu Stucco & Exteriors LLC",
        },
        "reconciliation": {
            "quoted_price": 99329.80, "actual_labor_hours": 451,
            "delivered_margin_pct": 26.4,
            "variance_labor_hours_pct": 15.05,
        },
        "state_history": [],
        "beta_create_calls": [],
        "create_calls": [],
        "assistant_replies": ["Stub reply 1", "Stub reply 2"],
        "reply_index": 0,
    }

    import core.anthropic_client as ac
    import core.db as core_db

    def fake_fetch_one(sql, params=None):
        sl = sql.lower()
        if "from bids b" in sl and "join companies" in sl:
            return state["bid"]
        if "from job_cost_reconciliation" in sl:
            return state["reconciliation"]
        return None

    def fake_fetch_all(sql, params=None):
        if "from bid_state_history" in sql.lower():
            return state["state_history"]
        return []

    monkeypatch.setattr(core_db, "fetch_one", fake_fetch_one)
    monkeypatch.setattr(core_db, "fetch_all", fake_fetch_all)

    class FakeBlock:
        def __init__(self, type_, text=None):
            self.type = type_
            if text is not None:
                self.text = text

    class FakeResp:
        def __init__(self, content):
            self.content = content

    def _next_response():
        text = state["assistant_replies"][
            state["reply_index"] % len(state["assistant_replies"])
        ]
        state["reply_index"] += 1
        return FakeResp([FakeBlock("text", text)])

    class FakeBetaMessages:
        def create(self, **kwargs):
            state["beta_create_calls"].append(kwargs)
            return _next_response()

    class FakeBeta:
        messages = FakeBetaMessages()

    class FakeMessages:
        def create(self, **kwargs):
            state["create_calls"].append(kwargs)
            return _next_response()

    class FakeClient:
        beta = FakeBeta()
        messages = FakeMessages()

    monkeypatch.setattr(ac, "get_client", lambda: FakeClient())
    return state


class TestSystemPromptLoadsFacts:
    def test_system_includes_bid_client_name(self, converse_stub):
        from agents import converse

        result = converse.reply(
            bid_id="bid-1", messages=[],
            user_message="What's the client name?",
        )
        system = converse_stub["beta_create_calls"][0]["system"]
        assert "Esprit Heights" in system

    def test_system_includes_pricing_and_reconciliation(self, converse_stub):
        from agents import converse

        converse.reply(
            bid_id="bid-1", messages=[],
            user_message="What was our margin?",
        )
        system = converse_stub["beta_create_calls"][0]["system"]
        assert "26.4" in system or "99329" in system
        # Variance comes from reconciliation
        assert "15.05" in system or "variance" in system.lower()


class TestCompactionWiring:
    def test_beta_header_set_when_compaction_enabled(self, converse_stub):
        from agents import converse

        converse.reply(
            bid_id="bid-1", messages=[],
            user_message="What was our margin?",
            enable_compaction=True,
        )
        call = converse_stub["beta_create_calls"][0]
        assert "compact-2026-01-12" in call["betas"]
        assert call["context_management"] == {
            "edits": [{"type": "compact_20260112"}]
        }

    def test_falls_back_to_non_beta_when_disabled(self, converse_stub):
        from agents import converse

        converse.reply(
            bid_id="bid-1", messages=[],
            user_message="What was our margin?",
            enable_compaction=False,
        )
        assert converse_stub["beta_create_calls"] == []
        assert len(converse_stub["create_calls"]) == 1


class TestMessageHistory:
    def test_response_content_preserved_not_text(self, converse_stub):
        """CRITICAL: the assistant turn must hold the full content list,
        not just the extracted text. Compaction state lives in blocks
        the SDK adds to response.content."""
        from agents import converse

        result = converse.reply(
            bid_id="bid-1", messages=[],
            user_message="Hello",
        )
        last_msg = result["messages"][-1]
        assert last_msg["role"] == "assistant"
        # content must be a LIST of blocks, not a string
        assert isinstance(last_msg["content"], list)
        # Each block has a .type attribute
        for block in last_msg["content"]:
            assert hasattr(block, "type")

    def test_multi_turn_history_carries_forward(self, converse_stub):
        from agents import converse

        turn1 = converse.reply(
            bid_id="bid-1", messages=[],
            user_message="What was our quoted price?",
        )
        turn2 = converse.reply(
            bid_id="bid-1", messages=turn1["messages"],
            user_message="And what was the variance?",
        )
        # After two turns: 4 messages (user, assistant, user, assistant)
        assert len(turn2["messages"]) == 4
        # The first turn's assistant content is preserved verbatim
        assert turn2["messages"][1] == turn1["messages"][1]

    def test_user_message_alternates_with_assistant(self, converse_stub):
        from agents import converse

        turn1 = converse.reply(
            bid_id="bid-1", messages=[],
            user_message="Q1",
        )
        turn2 = converse.reply(
            bid_id="bid-1", messages=turn1["messages"], user_message="Q2",
        )
        roles = [m["role"] for m in turn2["messages"]]
        assert roles == ["user", "assistant", "user", "assistant"]


class TestErrorPaths:
    def test_missing_bid_raises(self, converse_stub):
        from agents import converse

        converse_stub["bid"] = None  # _load_bid_facts will raise
        import core.db as core_db
        original = core_db.fetch_one
        core_db.fetch_one = lambda sql, params=None: None
        try:
            with pytest.raises(ValueError, match="not found"):
                converse.reply(
                    bid_id="nonexistent", messages=[],
                    user_message="hi",
                )
        finally:
            core_db.fetch_one = original
