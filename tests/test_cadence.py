"""Tests for segment-aware follow-up cadence (spec §5.7)."""
from __future__ import annotations

from tools.cadence_lookup import get_optimal_cadence


class TestRepeatCustomerCadence:
    def test_repeat_single_touch(self):
        cadence = get_optimal_cadence("repeat")
        assert len(cadence) == 1
        assert cadence[0]["sequence_number"] == 1
        assert cadence[0]["offset_hours"] == 24 * 5

    def test_repeat_tone_is_soft(self):
        cadence = get_optimal_cadence("repeat")
        assert "soft" in cadence[0]["tone"].lower()


class TestColdLeadCadence:
    def test_cold_lead_three_touches(self):
        cadence = get_optimal_cadence("cold_lead")
        assert len(cadence) == 3
        assert [s["sequence_number"] for s in cadence] == [1, 2, 3]

    def test_cold_lead_48hr_first_touch(self):
        cadence = get_optimal_cadence("cold_lead")
        assert cadence[0]["offset_hours"] == 48

    def test_new_client_uses_three_touch_too(self):
        cadence = get_optimal_cadence("new")
        assert len(cadence) == 3
