"""Tests for cost estimation via count_tokens."""
from __future__ import annotations

import pytest


@pytest.fixture
def fake_count_tokens(monkeypatch):
    """Stub the Anthropic count_tokens API."""
    state = {"input_tokens": 1500}

    class FakeResponse:
        @property
        def input_tokens(self):
            return state["input_tokens"]

    class FakeMessages:
        def count_tokens(self, **kwargs):
            state["last_call"] = kwargs
            return FakeResponse()

    class FakeClient:
        messages = FakeMessages()

    import core.anthropic_client as ac

    monkeypatch.setattr(ac, "get_client", lambda: FakeClient())
    return state


class TestEstimateInputTokens:
    def test_returns_token_count(self, fake_count_tokens):
        from core.cost import estimate_input_tokens

        result = estimate_input_tokens(
            model="claude-sonnet-4-6",
            system="You are a helpful assistant.",
            user="Hello",
        )
        assert result["input_tokens"] == 1500

    def test_cost_calculated_from_pricing_table(self, fake_count_tokens):
        from core.cost import estimate_input_tokens

        # Sonnet 4.6: $3 per 1M input tokens → 1500 tokens = $0.0045
        result = estimate_input_tokens(
            model="claude-sonnet-4-6",
            system="x",
            user="y",
        )
        assert result["estimated_input_cost_usd"] == pytest.approx(0.0045, abs=0.0001)

    def test_haiku_cheaper_than_sonnet(self, fake_count_tokens):
        from core.cost import estimate_input_tokens

        sonnet = estimate_input_tokens("claude-sonnet-4-6", "x", "y")
        haiku = estimate_input_tokens("claude-haiku-4-5", "x", "y")
        assert haiku["estimated_input_cost_usd"] < sonnet["estimated_input_cost_usd"]

    def test_unknown_model_returns_zero_cost(self, fake_count_tokens):
        from core.cost import estimate_input_tokens

        result = estimate_input_tokens(
            model="claude-opus-99-fake",
            system="x",
            user="y",
        )
        assert result["estimated_input_cost_usd"] == 0.0

    def test_count_tokens_called_with_correct_args(self, fake_count_tokens):
        from core.cost import estimate_input_tokens

        estimate_input_tokens(
            model="claude-sonnet-4-6",
            system="system_text",
            user="user_text",
        )
        call = fake_count_tokens["last_call"]
        assert call["model"] == "claude-sonnet-4-6"
        assert call["system"] == "system_text"
        assert call["messages"][0]["content"] == "user_text"


class TestEstimateBidGenerationCost:
    def test_assembles_composition_prompt_for_counting(
        self, mock_db, fake_count_tokens
    ):
        """End-to-end: estimate uses the same prompt structure as compose_bid."""
        from core.cost import estimate_bid_generation_cost

        result = estimate_bid_generation_cost(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="EIFS at Esprit Heights",
        )
        assert result["input_tokens"] == 1500
        # The system was sent as a list (matches Composition's caching shape)
        call = fake_count_tokens["last_call"]
        assert isinstance(call["system"], list)
        assert len(call["system"]) == 2  # SYSTEM_PROMPT + COMPANY_CONTEXT

    def test_degrades_gracefully_on_db_failure(self, monkeypatch):
        """If the DB lookup fails, return a soft error instead of raising."""
        from core.cost import estimate_bid_generation_cost

        # No mock_db fixture → DB calls will fail
        result = estimate_bid_generation_cost(
            company_id="missing",
            service_line="WHATEVER",
        )
        assert result["input_tokens"] is None
        assert "error" in result
