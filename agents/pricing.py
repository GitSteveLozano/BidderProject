"""Pricing agent — spec §5.4.

Behavior contract (CRITICAL): NEVER generates labor or material cost
numbers directly. Every numeric value traces to a tool call. Sonnet writes
the narrative rationale; deterministic calculation logic produces the
numbers. NEW v2: capacity-aware modifier.
"""
from __future__ import annotations

from datetime import date
from uuid import UUID


def _get_pricing_logic(company_id: UUID | str) -> dict:
    from core.db import fetch_one

    row = fetch_one(
        "SELECT * FROM pricing_logic WHERE company_id = %s", (str(company_id),)
    )
    return row or {}


def _labor_breakdown(company_id: str, labor_plan: list[dict]) -> dict:
    """labor_plan: [{trade: str, hours: float}, ...]. Returns merged breakdown."""
    from tools.labor_cost_lookup import get_loaded_labor_cost

    by_trade = []
    subtotal = 0.0
    total_hours = 0
    citations: list[str] = []
    for item in labor_plan:
        lookup = get_loaded_labor_cost(company_id, item["trade"], item["hours"])
        by_trade.append(lookup)
        if lookup["labor_subtotal"]:
            subtotal += lookup["labor_subtotal"]
            total_hours += int(item["hours"])
        citations.append(lookup["citation"])
    return {
        "by_trade": by_trade,
        "subtotal": round(subtotal, 2),
        "total_hours": total_hours,
        "citations": citations,
    }


def compute_pricing(
    company_id: UUID | str,
    service_line: str,
    labor_plan: list[dict],
    material_quantity: float,
    estimated_start_date: date,
    client_segment: str = "repeat",
) -> dict:
    """Produce a full pricing breakdown for a bid.

    All numbers come from tool calls; only the narrative rationale is LLM-
    generated.
    """
    from tools.capacity_lookup import capacity_modifier, get_capacity_utilization
    from tools.material_cost_lookup import lookup_material_cost
    from tools.win_rate_lookup import get_win_rate_at_price

    company_id = str(company_id)
    logic = _get_pricing_logic(company_id)

    labor = _labor_breakdown(company_id, labor_plan)
    materials = lookup_material_cost(service_line, material_quantity)
    materials_sub = materials.get("subtotal") or 0.0

    overhead_pct = float(logic.get("overhead_pct") or 18.0)
    target_margin_pct = float(logic.get("target_margin_pct") or 32.0)

    base_cost = labor["subtotal"] + materials_sub
    overhead_amount = round(base_cost * (overhead_pct / 100), 2)
    cost_with_overhead = base_cost + overhead_amount
    # target margin is applied on the final price (price - cost) / price = margin
    # → price = cost / (1 - margin)
    target_price = round(cost_with_overhead / (1 - target_margin_pct / 100), 2)
    profit = round(target_price - cost_with_overhead, 2)

    # Confidence interval ± based on margin range
    low_margin = float(logic.get("margin_range_low_pct") or 25.0)
    high_margin = float(logic.get("margin_range_high_pct") or 40.0)
    range_low = round(cost_with_overhead / (1 - low_margin / 100), 2)
    range_high = round(cost_with_overhead / (1 - high_margin / 100), 2)

    cap = get_capacity_utilization(company_id, estimated_start_date, weeks=4)
    start_util = cap["weeks"][0]["utilization"] if cap["weeks"] else 0.0
    modifier = capacity_modifier(
        start_util, logic.get("capacity_discount_behavior") or "flex_by_schedule"
    )

    win_rate = get_win_rate_at_price(company_id, service_line, target_price)

    breakdown = {
        "service_line": service_line,
        "labor": labor,
        "materials": materials,
        "overhead": {
            "pct": overhead_pct,
            "base": base_cost,
            "subtotal": overhead_amount,
        },
        "profit": {"subtotal": profit, "target_margin_pct": target_margin_pct},
        "target_price": target_price,
        "range_low": range_low,
        "range_high": range_high,
        "capacity_utilization_at_start": start_util,
        "capacity_window": cap["weeks"],
        "capacity_modifier": modifier,
        "win_rate_estimate": win_rate,
        "citations": labor["citations"]
        + [materials.get("citation")]
        + [cap["citation"], win_rate["citation"]],
    }

    breakdown["narrative"] = _generate_narrative(breakdown, client_segment)
    return breakdown


def _generate_narrative(breakdown: dict, client_segment: str) -> str:
    """LLM writes a short rationale. NEVER asked to compute or alter numbers."""
    from core.anthropic_client import complete
    from core.settings import get_settings

    facts = {
        "target_price": breakdown["target_price"],
        "range_low": breakdown["range_low"],
        "range_high": breakdown["range_high"],
        "labor_hours": breakdown["labor"]["total_hours"],
        "labor_subtotal": breakdown["labor"]["subtotal"],
        "materials_subtotal": breakdown["materials"].get("subtotal"),
        "overhead_subtotal": breakdown["overhead"]["subtotal"],
        "profit": breakdown["profit"]["subtotal"],
        "target_margin_pct": breakdown["profit"]["target_margin_pct"],
        "capacity_utilization": breakdown["capacity_utilization_at_start"],
        "capacity_action": breakdown["capacity_modifier"]["action"],
        "capacity_rationale": breakdown["capacity_modifier"]["rationale"],
        "win_rate": breakdown["win_rate_estimate"].get("win_rate"),
        "client_segment": client_segment,
    }
    import json

    return complete(
        model=get_settings().model_sonnet,
        system=(
            "You write a 3-4 sentence pricing rationale for a specialty contractor. "
            "You MUST NOT change or invent any numbers — you only narrate the facts "
            "provided. Mention capacity context if utilization is given. Keep it "
            "operational and direct."
        ),
        user=f"Facts (numbers are authoritative):\n{json.dumps(facts, default=str)}\n\nWrite the rationale.",
        max_tokens=512,
        temperature=0.3,
    )
