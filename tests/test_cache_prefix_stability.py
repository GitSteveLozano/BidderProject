"""Cache-prefix byte-stability regression test.

Anthropic's prompt cache is a prefix match — any byte change in the
prefix invalidates the cache for all downstream breakpoints. Silent
invalidators (non-deterministic JSON ordering, timestamps, UUIDs in
the system prompt) make `cache_read_input_tokens` go to zero on every
request, and there's no error to alert on.

This test hashes the cached prefix from the Composition agent across
multiple calls and asserts:
  1. Two bids for the SAME company produce IDENTICAL prefix bytes
     (cache hits expected).
  2. Two bids for DIFFERENT service lines (still same company) may
     differ — service line is part of the cacheable context — but
     same-service-line bids must be identical.
  3. Per-bid scope changes do NOT affect the cached prefix bytes.
"""
from __future__ import annotations

import hashlib

import pytest


def _prefix_hash(captured: dict) -> str:
    """Hash the system + system_extra portion that gets cache_control."""
    system = captured["system"]
    if isinstance(system, list):
        prefix_text = "".join(b.get("text", "") for b in system)
    else:
        prefix_text = system + "\n" + "\n".join(captured.get("system_extra", []))
    return hashlib.sha256(prefix_text.encode("utf-8")).hexdigest()


@pytest.fixture
def captured_create(monkeypatch):
    """Intercept anthropic.messages.create and capture the system payload."""
    captured: dict = {}

    class FakeMessage:
        content = [type("Block", (), {"type": "text", "text": "stub"})]
        usage = type("U", (), {"cache_read_input_tokens": 0,
                                "cache_creation_input_tokens": 0,
                                "input_tokens": 100, "output_tokens": 50})

    class FakeClient:
        class messages:
            @staticmethod
            def create(**kwargs):
                captured.clear()
                captured.update(kwargs)
                return FakeMessage()

    import core.anthropic_client as ac
    monkeypatch.setattr(ac, "get_client", lambda: FakeClient())
    return captured


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


class TestCachePrefixIsStable:
    def test_two_bids_same_company_have_identical_prefix(
        self, mock_db, captured_create
    ):
        """The whole point of caching — same company, different bids,
        same prefix bytes."""
        from agents import composition

        composition.compose_bid(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="Bid A scope",
            client_name="Client A",
            client_address="1 A St",
            pricing_breakdown=_stub_pricing(),
        )
        hash_a = _prefix_hash(captured_create)

        composition.compose_bid(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="Bid B scope — completely different",
            client_name="Client B",
            client_address="999 B Blvd",
            pricing_breakdown=_stub_pricing(),
        )
        hash_b = _prefix_hash(captured_create)

        assert hash_a == hash_b, (
            "Cache prefix differs between two bids for the same company. "
            "This means cache_read_input_tokens will be 0 on every request. "
            "A silent invalidator is in the Composition prompt construction."
        )

    def test_pricing_numbers_dont_leak_into_cached_prefix(
        self, mock_db, captured_create
    ):
        """Per-bid pricing must NOT be in the cacheable section, or the
        cache invalidates on every bid."""
        from agents import composition

        composition.compose_bid(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="x",
            client_name="x",
            client_address="x",
            pricing_breakdown=_stub_pricing(),
        )
        hash_low = _prefix_hash(captured_create)

        breakdown = _stub_pricing()
        breakdown["target_price"] = 999999.99
        breakdown["labor"]["subtotal"] = 50000.0
        composition.compose_bid(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="x",
            client_name="x",
            client_address="x",
            pricing_breakdown=breakdown,
        )
        hash_high = _prefix_hash(captured_create)

        assert hash_low == hash_high, (
            "Pricing numbers are leaking into the cached prefix. Move them "
            "to the user message (volatile, after the breakpoint)."
        )

    def test_different_service_line_changes_prefix(
        self, mock_db, captured_create
    ):
        """Sanity: when the service line genuinely changes, the prefix
        SHOULD differ (different scope template, different exclusions).
        This guards against the inverse bug — caching the prefix when
        the company context has actually changed."""
        from agents import composition

        composition.compose_bid(
            company_id="company-1",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="x",
            client_name="x",
            client_address="x",
            pricing_breakdown=_stub_pricing(),
        )
        hash_stucco = _prefix_hash(captured_create)

        # Configure the mock to return a different service line config
        mock_db["service_line"] = {
            "line_name": "EIFS",
            "typical_scope_text": "EIFS spec — completely different scope",
            "standard_exclusions": ["EIFS-specific exclusion"],
        }
        composition.compose_bid(
            company_id="company-1",
            service_line="EIFS",
            scope_summary="x",
            client_name="x",
            client_address="x",
            pricing_breakdown=_stub_pricing(),
        )
        hash_eifs = _prefix_hash(captured_create)

        assert hash_stucco != hash_eifs, (
            "Prefix hash didn't change when service line changed — "
            "the per-service-line context isn't in the cached prefix at all."
        )


class TestNoSilentInvalidators:
    """Audit for common silent invalidators per the caching guide."""

    def test_no_timestamps_in_prefix(self, mock_db, captured_create):
        """Smoke check: today's date should NOT appear in the cached prefix
        (would invalidate the cache on every day boundary)."""
        from datetime import date

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
        prefix_text = "".join(b.get("text", "") for b in system) if isinstance(system, list) else system
        today_iso = date.today().isoformat()
        assert today_iso not in prefix_text, (
            f"Today's date {today_iso} appears in the cached prefix. "
            "Move time-varying content to the user message."
        )
