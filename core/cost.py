"""Per-request cost estimation via Anthropic's count_tokens API.

Uses the Anthropic SDK's `messages.count_tokens` to predict input cost
before sending the actual generation request. Lets the UI show a "this
bid will cost about $X to generate" badge.

Pricing is hard-coded from the model catalog (per 1M tokens). Update
when the catalog changes — there is no programmatic pricing endpoint
in the public API.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

# $ per million tokens, from shared/models.md as of 2026-04-29
PRICING: dict[str, dict[str, float]] = {
    # input price / cache write 5min / cache write 1h / cache read / output
    "claude-opus-4-7":   {"input": 5.00, "write_5m": 6.25,  "write_1h": 10.00, "read": 0.50,  "output": 25.00},
    "claude-opus-4-6":   {"input": 5.00, "write_5m": 6.25,  "write_1h": 10.00, "read": 0.50,  "output": 25.00},
    "claude-sonnet-4-6": {"input": 3.00, "write_5m": 3.75,  "write_1h": 6.00,  "read": 0.30,  "output": 15.00},
    "claude-haiku-4-5":  {"input": 1.00, "write_5m": 1.25,  "write_1h": 2.00,  "read": 0.10,  "output": 5.00},
}


def estimate_input_tokens(
    model: str,
    system: str | list[dict],
    user: str,
) -> dict[str, Any]:
    """Call Anthropic's count_tokens endpoint and return token count + cost.

    Returns:
      {
        "input_tokens": int,
        "estimated_input_cost_usd": float,
        "model": str,
      }
    """
    from core.anthropic_client import get_client

    resp = get_client().messages.count_tokens(
        model=model,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    tokens = int(getattr(resp, "input_tokens", 0))
    rate = PRICING.get(model, {}).get("input", 0.0)
    return {
        "input_tokens": tokens,
        "estimated_input_cost_usd": round(tokens / 1_000_000 * rate, 6),
        "model": model,
    }


def estimate_bid_generation_cost(
    company_id: str | None = None,
    service_line: str | None = None,
    scope_summary: str = "",
    pricing_breakdown: dict | None = None,
) -> dict[str, Any]:
    """Compose the same prompt the Composition agent would build, then
    count tokens. Used by the UI to show pre-generation cost.

    Best-effort: if a tool/db call fails (e.g. company not loaded), we
    return a degraded estimate rather than erroring.
    """
    try:
        from agents.composition import (
            COMPANY_CONTEXT_TEMPLATE,
            SYSTEM_PROMPT,
            USER_TEMPLATE,
            _get_service_line,
            _get_voice,
        )
        from core.settings import get_settings

        voice = _get_voice(company_id) if company_id else {}
        sl = _get_service_line(company_id, service_line) if (company_id and service_line) else {}
        exclusions = sl.get("standard_exclusions") or []

        import json
        voice_summary = {
            "tone": voice.get("tone"),
            "preferred_terms": voice.get("preferred_terms"),
            "boilerplate_intro": voice.get("boilerplate_intro"),
            "boilerplate_scope_intro": voice.get("boilerplate_scope_intro"),
            "boilerplate_terms": voice.get("boilerplate_terms"),
            "boilerplate_warranty": voice.get("boilerplate_warranty"),
            "boilerplate_closing": voice.get("boilerplate_closing"),
        }
        company_context = COMPANY_CONTEXT_TEMPLATE.format(
            voice=json.dumps(voice_summary, default=str, indent=2, sort_keys=True),
            service_line=service_line or "—",
            scope_template=sl.get("typical_scope_text") or "",
            exclusions_list="\n".join(f"  - {e}" for e in exclusions) or "  (none)",
        )

        pb = pricing_breakdown or {
            "target_price": 0, "labor": {"total_hours": 0, "subtotal": 0},
            "materials": {"subtotal": 0}, "overhead": {"subtotal": 0},
            "profit": {"target_margin_pct": 0},
        }
        user_msg = USER_TEMPLATE.format(
            scope_summary=scope_summary,
            client_name="(client)",
            client_address="(address)",
            target_price=pb["target_price"],
            labor_hours=pb["labor"]["total_hours"],
            labor_subtotal=pb["labor"]["subtotal"],
            materials_subtotal=pb["materials"].get("subtotal") or 0,
            overhead_subtotal=pb["overhead"]["subtotal"],
            target_margin_pct=pb["profit"]["target_margin_pct"],
        )

        system_blocks: list[dict] = [
            {"type": "text", "text": SYSTEM_PROMPT},
            {"type": "text", "text": company_context},
        ]
        return estimate_input_tokens(
            model=get_settings().model_sonnet,
            system=system_blocks,
            user=user_msg,
        )
    except Exception as e:
        logger.warning("cost estimation failed: %s", e)
        return {"input_tokens": None, "estimated_input_cost_usd": None,
                "model": None, "error": str(e)}
