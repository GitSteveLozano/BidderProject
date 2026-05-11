"""Pricing agent — proper Anthropic tool-use variant.

Same behavior contract as `pricing.compute_pricing` but Claude itself
chooses which tools to call. This is the demo-friendly variant because
the agent trail shows the LLM reaching for a specific tool to get a
specific number — which is the single most compelling "not a GPT wrapper"
moment.

Behavior contract: NEVER generates a labor cost, material cost, or
capacity utilization number from text. Every numeric value in the output
must come from a tool_result block. The tools handle all DB lookups.
"""
from __future__ import annotations

import json
import logging
from datetime import date
from uuid import UUID

import anthropic

from core.anthropic_client import get_client
from core.settings import get_settings
from tools.capacity_lookup import capacity_modifier, get_capacity_utilization
from tools.labor_cost_lookup import get_loaded_labor_cost
from tools.material_cost_lookup import lookup_material_cost
from tools.win_rate_lookup import get_win_rate_at_price

logger = logging.getLogger(__name__)


TOOLS: list[dict] = [
    {
        "name": "get_loaded_labor_cost",
        "description": (
            "Returns the fully-burdened labor cost for the given trade and "
            "number of hours. Loaded rate includes FICA, FUTA, SUTA, workers "
            "comp by NCCI class, PHCA health, TDI, retirement match, PTO, "
            "training. CALL THIS — do not estimate labor costs from text."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "trade": {
                    "type": "string",
                    "description": "trade classification, e.g. stucco_journeyman, "
                                   "eifs_installer, siding_installer, general_laborer",
                },
                "hours": {
                    "type": "number",
                    "description": "labor hours to cost",
                },
            },
            "required": ["trade", "hours"],
        },
    },
    {
        "name": "lookup_material_cost",
        "description": (
            "Returns the material subtotal for the given service line and "
            "quantity. Includes waste factor. CALL THIS — do not estimate "
            "material costs from text."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "service_line": {"type": "string"},
                "quantity": {"type": "number"},
            },
            "required": ["service_line", "quantity"],
        },
    },
    {
        "name": "get_capacity_utilization",
        "description": (
            "Returns the per-week schedule utilization forecast over a "
            "window of weeks starting at start_date. Use this to inform the "
            "capacity_modifier — should the price hold firm (full schedule) "
            "or flex down (light schedule)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "start_date": {
                    "type": "string",
                    "description": "ISO date (YYYY-MM-DD) for the start of the window",
                },
                "weeks": {"type": "integer", "default": 4},
            },
            "required": ["start_date"],
        },
    },
    {
        "name": "get_win_rate_at_price",
        "description": (
            "Returns historical win rate for similar bids at this service "
            "line and price band. Only informative for cold-bidding "
            "segments; for repeat-customer segments win rate is largely "
            "schedule-driven and this returns thin data."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "service_line": {"type": "string"},
                "target_price": {"type": "number"},
            },
            "required": ["service_line", "target_price"],
        },
    },
]


SYSTEM_PROMPT = """You are the Pricing agent in a specialty-contractor bid
system. Your job is to produce a calibrated pricing recommendation with a
full breakdown and a capacity-aware modifier.

CRITICAL behavior contract (NEVER violate):
- You MUST NOT generate any labor cost, material cost, or capacity
  utilization number from text. Every numeric value MUST come from a
  tool call result.
- For each labor trade in the bid, you call get_loaded_labor_cost.
- For materials, you call lookup_material_cost.
- For the start window, you call get_capacity_utilization.
- For the price band, you may call get_win_rate_at_price.

After collecting all tool results, you return a final JSON object with
the full breakdown. Use the tool results' citation strings inside your
output's `citations` array so every number traces back.

Final output JSON shape (ONLY return this JSON in your final message,
nothing else, no code fence):
{
  "labor": {"by_trade": [tool_result_dicts], "subtotal": number, "total_hours": int},
  "materials": tool_result_dict,
  "overhead": {"pct": number, "subtotal": number},
  "profit": {"subtotal": number, "target_margin_pct": number},
  "target_price": number,
  "range_low": number,
  "range_high": number,
  "capacity_utilization_at_start": number,
  "capacity_modifier": {"action": str, "modifier_pct": number, "rationale": str},
  "win_rate_estimate": tool_result_dict_or_null,
  "citations": [str],
  "narrative": "3-4 sentence rationale (numbers must match the dict above)"
}
"""


def _dispatch_tool(name: str, company_id: str, args: dict) -> dict:
    if name == "get_loaded_labor_cost":
        return get_loaded_labor_cost(company_id, args["trade"], float(args["hours"]))
    if name == "lookup_material_cost":
        return lookup_material_cost(args["service_line"], float(args["quantity"]))
    if name == "get_capacity_utilization":
        start = date.fromisoformat(args["start_date"])
        weeks = int(args.get("weeks", 4))
        result = get_capacity_utilization(company_id, start, weeks=weeks)
        # Attach the recommended modifier so the LLM can quote it
        if result.get("weeks"):
            util = result["weeks"][0]["utilization"]
            result["recommended_modifier"] = capacity_modifier(util)
        return result
    if name == "get_win_rate_at_price":
        return get_win_rate_at_price(
            company_id, args["service_line"], float(args["target_price"])
        )
    return {"error": f"unknown tool {name}"}


def compute_pricing_tool_use(
    company_id: UUID | str,
    service_line: str,
    labor_plan: list[dict],
    material_quantity: float,
    estimated_start_date: date,
    target_margin_pct: float = 32.0,
    overhead_pct: float = 18.0,
    margin_range: tuple[float, float] = (25.0, 40.0),
    max_iterations: int = 10,
) -> dict:
    """Run the Pricing agent with real Anthropic tool-use.

    Returns the structured JSON the agent produced. The trail of
    tool_use / tool_result blocks is logged at INFO level so the demo UI
    can render it.
    """
    company_id = str(company_id)
    client = get_client()
    model = get_settings().model_sonnet

    user_msg = (
        f"Generate the pricing for this bid:\n\n"
        f"- service_line: {service_line}\n"
        f"- labor_plan (call get_loaded_labor_cost for each):\n"
        + "\n".join(f"  - {item['trade']}: {item['hours']} hours" for item in labor_plan)
        + f"\n- material_quantity: {material_quantity}\n"
        + f"- estimated_start_date: {estimated_start_date.isoformat()}\n"
        + f"- target_margin_pct: {target_margin_pct}\n"
        + f"- overhead_pct: {overhead_pct}\n"
        + f"- margin_range: low={margin_range[0]}%, high={margin_range[1]}%\n\n"
        + "Call the tools you need, then return the final JSON object."
    )
    messages: list[dict] = [{"role": "user", "content": user_msg}]
    trail: list[dict] = []

    for _ in range(max_iterations):
        resp = client.messages.create(
            model=model,
            max_tokens=4096,
            tools=TOOLS,
            messages=messages,
            system=SYSTEM_PROMPT,
        )

        if resp.stop_reason == "tool_use":
            tool_uses = [b for b in resp.content if getattr(b, "type", None) == "tool_use"]
            text_blocks = [b for b in resp.content if getattr(b, "type", None) == "text"]
            tool_results = []
            for tu in tool_uses:
                result = _dispatch_tool(tu.name, company_id, dict(tu.input))
                trail.append({
                    "tool": tu.name,
                    "input": dict(tu.input),
                    "result_summary": _summarize_for_trail(result),
                })
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tu.id,
                    "content": json.dumps(result, default=str),
                })
            messages.append({"role": "assistant", "content": resp.content})
            messages.append({"role": "user", "content": tool_results})
            continue

        # Final text response
        text = "".join(
            b.text for b in resp.content if getattr(b, "type", None) == "text"
        ).strip()
        try:
            payload = _parse_json(text)
        except json.JSONDecodeError as e:
            logger.warning("Pricing agent returned non-JSON: %s", e)
            payload = {"error": "invalid JSON from agent", "raw": text}
        payload["_tool_trail"] = trail
        return payload

    return {"error": "pricing agent exceeded max iterations", "_tool_trail": trail}


def _parse_json(text: str) -> dict:
    import re

    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fenced:
        return json.loads(fenced.group(1))
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise json.JSONDecodeError("no JSON object in response", text, 0)
    return json.loads(match.group(0))


def _summarize_for_trail(result: dict) -> str:
    """Short string for the demo UI's agent trail panel."""
    if "labor_subtotal" in result:
        return (
            f"{result.get('matched_classifications', result.get('trade'))} × "
            f"{result.get('hours')}h @ ${result.get('avg_loaded_rate')}/h = "
            f"${result.get('labor_subtotal')}"
        )
    if "subtotal" in result and "service_line" in result:
        return f"{result['service_line']} × {result.get('quantity')} = ${result['subtotal']}"
    if "avg_utilization" in result:
        return f"{int(result['avg_utilization']*100)}% avg over {result['window_weeks']}w"
    if "win_rate" in result:
        return (
            f"win rate {result['win_rate']} on {result.get('n_comparable')} comparable bids"
            if result["win_rate"] is not None
            else result.get("citation", "n/a")
        )
    return str(result)[:120]
