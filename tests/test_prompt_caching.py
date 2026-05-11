"""Prompt caching wiring tests.

These don't actually hit Anthropic — they verify that the Composition
and Intelligence agents pass the correct `system` / `system_extra` /
`cache_system` arguments through to the SDK call. Caching is a
silent-fail feature (a wrong placement just returns cache_read=0
instead of erroring), so we have to test the construction.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def captured_create(monkeypatch):
    """Intercept anthropic.messages.create and capture the request payload."""
    captured: dict = {}

    class FakeMessage:
        content = [type("Block", (), {"type": "text", "text": "stub"})]
        usage = type("U", (), {
            "cache_read_input_tokens": 0,
            "cache_creation_input_tokens": 0,
            "input_tokens": 100,
            "output_tokens": 50,
        })

    class FakeMessages:
        def create(self, **kwargs):
            captured.update(kwargs)
            return FakeMessage()

    class FakeClient:
        messages = FakeMessages()

    import core.anthropic_client as ac

    monkeypatch.setattr(ac, "get_client", lambda: FakeClient())
    return captured


class TestCompositionCaching:
    def test_company_context_goes_in_system_with_cache_breakpoint(
        self, mock_db, captured_create
    ):
        from agents import composition

        composition.compose_bid(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="x",
            client_name="x",
            client_address="x",
            pricing_breakdown=_stub_pricing(),
        )
        system = captured_create["system"]
        # Should be a list of blocks (not bare string) because cache_system=True
        assert isinstance(system, list), f"expected list, got {type(system)}"
        assert len(system) == 2  # SYSTEM_PROMPT + company_context
        # Breakpoint anchored on the last block
        assert system[-1].get("cache_control") == {"type": "ephemeral"}
        # Frozen SYSTEM_PROMPT first (no cache_control on it directly)
        assert "cache_control" not in system[0]

    def test_per_bid_content_stays_in_user_message(self, mock_db, captured_create):
        """Volatile content (scope, client, pricing) must NOT be in system."""
        from agents import composition

        composition.compose_bid(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="UNIQUE_SCOPE_TOKEN",
            client_name="UNIQUE_CLIENT_TOKEN",
            client_address="x",
            pricing_breakdown=_stub_pricing(),
        )
        system_text = "".join(b["text"] for b in captured_create["system"])
        user_text = captured_create["messages"][0]["content"]

        # Volatile tokens must be in the user message, NOT in system
        assert "UNIQUE_SCOPE_TOKEN" in user_text
        assert "UNIQUE_CLIENT_TOKEN" in user_text
        assert "UNIQUE_SCOPE_TOKEN" not in system_text
        assert "UNIQUE_CLIENT_TOKEN" not in system_text

    def test_voice_profile_in_cacheable_system_extra(self, mock_db, captured_create):
        """Voice patterns are stable per company — must be in the
        cacheable system_extra block, not the volatile user message."""
        from agents import composition

        mock_db["voice"]["tone"] = "STABLE_TONE_MARKER"
        composition.compose_bid(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="x",
            client_name="x",
            client_address="x",
            pricing_breakdown=_stub_pricing(),
        )
        system_blocks = captured_create["system"]
        # Voice marker should be in the second system block (the
        # company_context block with cache_control), not the user message
        company_context = system_blocks[1]["text"]
        assert "STABLE_TONE_MARKER" in company_context


class TestDeterministicSerialization:
    """Caching is byte-exact. Non-deterministic JSON ordering would
    silently invalidate the cache on every request — these tests guard
    against that regression."""

    def test_voice_json_is_sort_keys(self, mock_db, captured_create, monkeypatch):
        from agents import composition

        # Provide preferred_terms with keys in two different orders;
        # both calls should produce identical system bytes if the
        # serialization is deterministic.
        mock_db["voice"]["preferred_terms"] = {"scope": ["a"], "client": ["b"]}
        composition.compose_bid(
            company_id="company-1", service_line="STUCCO-CONVENTIONAL",
            scope_summary="x", client_name="x", client_address="x",
            pricing_breakdown=_stub_pricing(),
        )
        first_system = "".join(b["text"] for b in captured_create["system"])

        # Same data, reordered dict
        mock_db["voice"]["preferred_terms"] = {"client": ["b"], "scope": ["a"]}
        composition.compose_bid(
            company_id="company-1", service_line="STUCCO-CONVENTIONAL",
            scope_summary="x", client_name="x", client_address="x",
            pricing_breakdown=_stub_pricing(),
        )
        second_system = "".join(b["text"] for b in captured_create["system"])

        assert first_system == second_system, (
            "voice JSON must be sort_keys=True to keep the cache prefix stable"
        )


class TestIntelligenceCaching:
    def test_intelligence_narrative_caches_system(self, monkeypatch, captured_create):
        from agents import intelligence

        intelligence._llm_insight_narrative(
            "capacity",
            {"avg_utilization": 0.85},
            "Recommend holding firm.",
        )
        system = captured_create["system"]
        assert isinstance(system, list)
        assert system[-1].get("cache_control") == {"type": "ephemeral"}


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
