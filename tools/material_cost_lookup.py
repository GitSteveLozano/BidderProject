"""Material cost lookup (simulated for PoC).

Spec §12.6: real material cost API integrations are out of scope. The
Pricing agent treats this as a tool call so the architecture is unchanged
when ProService swaps in a real catalog later.
"""
from __future__ import annotations

# Per-unit costs calibrated to Hawaii contractor norms (2026 ballpark).
# Source notes in seed_data/material_cost_basis.md.
_MATERIAL_RATES: dict[str, dict] = {
    "STUCCO-CONVENTIONAL": {"unit": "sqft", "cost_per_unit": 7.20, "waste_factor": 0.10},
    "STUCCO-textured acrylic": {"unit": "sqft", "cost_per_unit": 8.40, "waste_factor": 0.10},
    "EIFS": {"unit": "sqft", "cost_per_unit": 11.50, "waste_factor": 0.08},
    "Siding": {"unit": "sqft", "cost_per_unit": 9.80, "waste_factor": 0.12},
    "METAL WORK": {"unit": "lf", "cost_per_unit": 14.00, "waste_factor": 0.08},
    "RESTUCCO": {"unit": "sqft", "cost_per_unit": 5.40, "waste_factor": 0.10},
    "REPAIR": {"unit": "lump_sum", "cost_per_unit": 1.0, "waste_factor": 0.0},
    "DEMOLITION": {"unit": "sqft", "cost_per_unit": 2.80, "waste_factor": 0.0},
}


def lookup_material_cost(service_line: str, quantity: float) -> dict:
    rate = _MATERIAL_RATES.get(service_line)
    if rate is None:
        return {
            "service_line": service_line,
            "quantity": quantity,
            "subtotal": None,
            "citation": "no material rate for this service line",
        }
    waste = rate["waste_factor"]
    effective_qty = quantity * (1 + waste)
    subtotal = round(effective_qty * rate["cost_per_unit"], 2)
    return {
        "service_line": service_line,
        "quantity": quantity,
        "unit": rate["unit"],
        "cost_per_unit": rate["cost_per_unit"],
        "waste_factor": waste,
        "subtotal": subtotal,
        "citation": f"{quantity}{rate['unit']} × ({1+waste:.0%}) × ${rate['cost_per_unit']:.2f}",
    }
