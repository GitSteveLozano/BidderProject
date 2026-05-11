"""Tests for material cost lookup."""
from __future__ import annotations

import pytest

from tools.material_cost_lookup import lookup_material_cost


class TestKnownServiceLines:
    def test_stucco_conventional(self):
        result = lookup_material_cost("STUCCO-CONVENTIONAL", 1000)
        assert result["unit"] == "sqft"
        # 1000 * 1.10 (waste) * 7.20 = 7920
        assert result["subtotal"] == pytest.approx(7920, abs=0.01)

    def test_eifs_with_waste(self):
        result = lookup_material_cost("EIFS", 1000)
        # 1000 * 1.08 * 11.50 = 12420
        assert result["subtotal"] == pytest.approx(12420, abs=0.01)


class TestUnknownServiceLine:
    def test_unknown_returns_none_subtotal(self):
        result = lookup_material_cost("UNKNOWN-LINE", 1000)
        assert result["subtotal"] is None
        assert "no material rate" in result["citation"]
