"""Tests for capacity_modifier — pure logic, no DB."""
from __future__ import annotations

import pytest

from tools.capacity_lookup import capacity_modifier


class TestCapacityModifier:
    def test_full_schedule_holds_firm(self):
        result = capacity_modifier(0.92)
        assert result["action"] == "hold_firm"
        assert result["modifier_pct"] == 0.0

    def test_healthy_schedule_holds(self):
        result = capacity_modifier(0.75)
        assert result["action"] == "hold"

    def test_moderate_schedule_considers_small_discount(self):
        result = capacity_modifier(0.55)
        assert result["action"] == "consider_small_discount"
        assert result["modifier_pct"] < 0

    def test_low_schedule_considers_discount(self):
        result = capacity_modifier(0.30)
        assert result["action"] == "consider_discount"
        assert result["modifier_pct"] <= -5.0

    def test_fixed_behavior_always_holds(self):
        for util in [0.10, 0.50, 0.95]:
            result = capacity_modifier(util, behavior="fixed")
            assert result["action"] == "hold"
            assert result["modifier_pct"] == 0.0
