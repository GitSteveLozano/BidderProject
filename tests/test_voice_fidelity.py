"""Voice fidelity guard.

The Composition agent must include the company's boilerplate and the
service-line standard exclusions in the prompt it sends to Claude. If
the prompt construction drops these, the model has no way to write in
voice or include exclusions even if it wanted to.

These tests don't call the LLM. They capture the system + user prompt
the agent builds and assert structural properties — boilerplate
fragments and exclusion phrases must be present.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def captured_prompts(monkeypatch):
    """Intercept core.anthropic_client.complete and capture call args.

    Exposes:
      `system_text` — concatenation of system + system_extra blocks
      `user`        — the user-message content
      `combined`    — system_text + user (for "is X anywhere in the prompt" assertions)
    """
    captured: dict = {}

    import core.anthropic_client as ac

    def fake_complete(model, system, user, system_extra=None, cache_system=False, **kwargs):
        captured["model"] = model
        captured["system"] = system
        captured["system_extra"] = system_extra or []
        captured["user"] = user
        captured["cache_system"] = cache_system
        captured["system_text"] = system + "\n" + "\n".join(captured["system_extra"])
        captured["combined"] = captured["system_text"] + "\n" + user
        return "STUB_BID_MARKDOWN with Test exclusion 1 and Test exclusion 2"

    monkeypatch.setattr(ac, "complete", fake_complete)
    return captured


class TestCompositionPromptIncludesBoilerplate:
    def test_user_message_contains_boilerplate_intro(self, mock_db, captured_prompts):
        from agents import composition

        mock_db["voice"] = {
            "tone": "direct",
            "boilerplate_intro": "Thank you for the opportunity to provide a quote on this project.",
            "boilerplate_scope_intro": "Our scope of work consists of the following:",
            "boilerplate_terms": "Net 30 from invoice.",
            "boilerplate_warranty": "All workmanship is warranted for one year.",
            "boilerplate_closing": "We appreciate the opportunity.",
        }
        mock_db["service_line"] = {
            "line_name": "STUCCO-CONVENTIONAL",
            "typical_scope_text": "three-coat stucco",
            "standard_exclusions": ["Test exclusion 1", "Test exclusion 2"],
        }
        composition.compose_bid(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="Test scope",
            client_name="Test Client",
            client_address="1 Test Way",
            pricing_breakdown=_stub_pricing(),
        )
        # Boilerplate lives in the cacheable system_extra block; assert
        # it's anywhere in the assembled prompt.
        assert "Thank you for the opportunity" in captured_prompts["combined"]
        assert "Net 30" in captured_prompts["combined"]
        assert "All workmanship is warranted" in captured_prompts["combined"]

    def test_user_message_includes_all_standard_exclusions(self, mock_db, captured_prompts):
        from agents import composition

        mock_db["service_line"] = {
            "line_name": "EIFS",
            "typical_scope_text": "EIFS spec",
            "standard_exclusions": [
                "Rough grade should not be above final grade height",
                "Painting beyond integral finish color",
                "Sheet metal flashings",
            ],
        }
        composition.compose_bid(
            company_id="company-1",
            service_line="EIFS",
            scope_summary="EIFS scope",
            client_name="Test",
            client_address="",
            pricing_breakdown=_stub_pricing(),
        )
        combined = captured_prompts["combined"]
        assert "Rough grade should not be above final grade height" in combined
        assert "Painting beyond integral finish color" in combined
        assert "Sheet metal flashings" in combined

    def test_system_prompt_forbids_pricing_modification(self, mock_db, captured_prompts):
        from agents import composition

        composition.compose_bid(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="x",
            client_name="x",
            client_address="x",
            pricing_breakdown=_stub_pricing(),
        )
        system = captured_prompts["system"]
        # The behavior contract: do NOT modify pricing numbers
        assert "do NOT" in system.lower() or "do not" in system.lower()
        assert (
            "pricing" in system.lower()
            or "numbers" in system.lower()
            or "invent" in system.lower()
        )

    def test_user_message_includes_exact_pricing_numbers(self, mock_db, captured_prompts):
        """The pricing breakdown numbers must be in the user prompt
        verbatim so the LLM has no excuse to invent or round them."""
        from agents import composition

        breakdown = _stub_pricing()
        breakdown["target_price"] = 48200.50
        breakdown["labor"]["subtotal"] = 15038.75
        breakdown["materials"]["subtotal"] = 12400.00
        composition.compose_bid(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="x",
            client_name="x",
            client_address="x",
            pricing_breakdown=breakdown,
        )
        user = captured_prompts["user"]
        assert "48,200.50" in user or "$48,200.50" in user
        assert "15,038.75" in user
        assert "12,400.00" in user

    def test_voice_tone_is_in_user_message(self, mock_db, captured_prompts):
        from agents import composition

        mock_db["voice"]["tone"] = "direct, no-nonsense, formal"
        composition.compose_bid(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="x",
            client_name="x",
            client_address="x",
            pricing_breakdown=_stub_pricing(),
        )
        # Voice tone is part of the cacheable company context (system_extra)
        assert "direct, no-nonsense, formal" in captured_prompts["combined"]


class TestPricingNarrativePromptForbidsNumberInvention:
    def test_pricing_narrative_system_forbids_changing_numbers(self, monkeypatch):
        """The Pricing agent's narrative LLM call MUST be told not to
        change numbers. This is the load-bearing prompt for the
        hallucination-resistance guarantee in spec §1.5."""
        captured: dict = {}
        import core.anthropic_client as ac

        def fake_complete(model, system, user, **kwargs):
            captured["system"] = system
            captured["user"] = user
            return "stub narrative"

        monkeypatch.setattr(ac, "complete", fake_complete)
        from agents import pricing as pricing_mod

        pricing_mod._generate_narrative(
            {
                "target_price": 48200,
                "range_low": 44000,
                "range_high": 52500,
                "labor": {"total_hours": 312, "subtotal": 15038},
                "materials": {"subtotal": 12400},
                "overhead": {"subtotal": 4938},
                "profit": {"subtotal": 14000, "target_margin_pct": 32.0},
                "capacity_utilization_at_start": 0.82,
                "capacity_modifier": {"action": "hold_firm", "rationale": "full"},
                "win_rate_estimate": {"win_rate": 0.72},
            },
            client_segment="repeat",
        )
        system = captured["system"]
        # Behavior contract: do not change/invent numbers
        assert ("not change" in system.lower() or "not invent" in system.lower()
                or "must not" in system.lower())


# ─── helpers ─────────────────────────────────────────────────


def _stub_pricing() -> dict:
    return {
        "labor": {"total_hours": 312, "subtotal": 15038.0, "by_trade": []},
        "materials": {"subtotal": 12400.0},
        "overhead": {"subtotal": 4938.84},
        "profit": {"subtotal": 14000.0, "target_margin_pct": 32.0},
        "target_price": 46200.0,
        "range_low": 43000.0,
        "range_high": 50000.0,
        "capacity_utilization_at_start": 0.82,
        "capacity_modifier": {"action": "hold_firm", "rationale": "full schedule"},
    }
