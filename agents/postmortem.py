"""Loss postmortem agent — analyze a LOST bid.

Takes a bid with outcome=LOST and (optionally) competitor + winning_bid
data, plus the company's pricing logic, win-rate history, and any
similar past LOSS bids. Returns structured "why we lost + what to
change" output that surfaces as an intelligence_insights row.

Not in spec §5 (the 8 agents). This is an opinionated extension that
reuses existing data — competitor + outcome_winning_bid have been
captured since v1 but never analyzed. Sits architecturally next to
Intelligence: same async pattern, same context-store reads, but
runs on-demand per bid rather than weekly across the corpus.

Behavior contract:
  - Pricing facts are passed verbatim (no LLM-invented numbers).
  - Cached system prompt + per-company context (matches Composition's
    caching strategy for cross-bid prefix reuse).
  - Writes an intelligence_insights row with category='competitor' so
    findings surface on the existing dashboard.
"""
from __future__ import annotations

import json
from uuid import UUID

SYSTEM_PROMPT = """You write structured loss-postmortem analyses for a
specialty contractor. You are given:
- The lost bid (scope, our price, our labor hours, our exclusions)
- The winning competitor's name and price (when known)
- The company's pricing logic (target margin, range, capacity behavior)
- Recent comparable LOST bids for this service line
- Win rate history for similar price bands

Produce structured JSON in this exact shape (return ONLY the JSON):

{
  "likely_reasons": [str],
  "price_gap_analysis": {
    "our_price": number,
    "winning_price": number|null,
    "delta_usd": number|null,
    "delta_pct": number|null,
    "interpretation": str
  },
  "exclusions_signal": str,
  "capacity_factor": str,
  "pattern_across_recent_losses": str,
  "recommendations_for_next_bid": [str],
  "confidence": "low" | "medium" | "high"
}

Rules:
- Reasons must be specific to this bid — never generic "they were cheaper".
  Reference the price delta, exclusions diff, capacity at quote, etc.
- Confidence is "low" when n<3 comparable losses, "medium" at 3-7, "high" at 8+.
- DO NOT invent numbers. Every dollar/percent comes from the facts provided.
"""


def analyze_loss(bid_id: UUID | str, write_insight: bool = True) -> dict:
    """Run the postmortem on a single LOST bid.

    Returns the structured JSON result. If write_insight=True, also
    appends an intelligence_insights row so the finding shows up on
    the dashboard.
    """
    from core.anthropic_client import complete_json
    from core.audit import record as audit_record
    from core.db import execute, fetch_all, fetch_one
    from core.settings import get_settings

    bid_id = str(bid_id)
    bid = fetch_one(
        """
        SELECT id, company_id, client_name, service_line, scope_summary,
               estimated_value, estimated_labor_hours, capacity_at_quote,
               exclusions_applied, exclusions_missing, outcome,
               outcome_reason, outcome_competitor, outcome_winning_bid,
               pricing_breakdown
        FROM bids WHERE id = %s
        """,
        (bid_id,),
    )
    if not bid:
        raise ValueError(f"bid {bid_id} not found")
    if bid["outcome"] != "LOST":
        raise ValueError(
            f"postmortem only runs on LOST bids; this one is {bid['outcome']}"
        )

    # Recent comparable losses for context
    recent_losses = fetch_all(
        """
        SELECT estimated_value, outcome_competitor, outcome_winning_bid,
               estimated_labor_hours, exclusions_missing
        FROM bids
        WHERE company_id = %s
          AND service_line = %s
          AND outcome = 'LOST'
          AND id != %s
        ORDER BY outcome_captured_at DESC NULLS LAST
        LIMIT 10
        """,
        (bid["company_id"], bid["service_line"], bid_id),
    )

    # Pricing logic for context
    pl = fetch_one(
        "SELECT * FROM pricing_logic WHERE company_id = %s",
        (bid["company_id"],),
    )

    # Compute the price gap up front so the LLM sees an authoritative number
    our_price = float(bid["estimated_value"] or 0)
    winning_price = (
        float(bid["outcome_winning_bid"])
        if bid.get("outcome_winning_bid") is not None
        else None
    )
    delta_usd = (
        round(our_price - winning_price, 2)
        if winning_price is not None and our_price
        else None
    )
    delta_pct = (
        round((our_price - winning_price) / our_price * 100, 2)
        if winning_price is not None and our_price
        else None
    )

    facts = {
        "bid": {
            "client_name": bid["client_name"],
            "service_line": bid["service_line"],
            "scope_summary": (bid["scope_summary"] or "")[:500],
            "our_price": our_price,
            "labor_hours": bid["estimated_labor_hours"],
            "exclusions_applied": bid.get("exclusions_applied") or [],
            "exclusions_skipped": bid.get("exclusions_missing") or [],
            "capacity_at_quote": float(bid.get("capacity_at_quote") or 0),
        },
        "competitor": {
            "name": bid.get("outcome_competitor"),
            "winning_price": winning_price,
            "delta_usd": delta_usd,
            "delta_pct": delta_pct,
        },
        "company_pricing_logic": {
            "target_margin_pct": float((pl or {}).get("target_margin_pct") or 32),
            "margin_range_low_pct": float((pl or {}).get("margin_range_low_pct") or 25),
            "margin_range_high_pct": float((pl or {}).get("margin_range_high_pct") or 40),
            "capacity_behavior": (pl or {}).get("capacity_discount_behavior")
                or "flex_by_schedule",
        },
        "recent_comparable_losses": [
            {
                "value": float(r["estimated_value"] or 0),
                "competitor": r.get("outcome_competitor"),
                "winning_bid": float(r["outcome_winning_bid"])
                    if r.get("outcome_winning_bid") is not None else None,
            }
            for r in recent_losses
        ],
        "n_recent_losses": len(recent_losses),
    }

    # Per-company stable context (cached); per-bid facts (volatile)
    company_context = (
        f"Company id: {bid['company_id']}\n"
        f"Pricing logic for this company:\n{json.dumps(facts['company_pricing_logic'], sort_keys=True)}\n\n"
        f"Recent comparable LOSS history (last {len(recent_losses)}):\n"
        f"{json.dumps(facts['recent_comparable_losses'], sort_keys=True)}\n"
    )
    user_msg = (
        f"Loss postmortem facts (authoritative — do not invent numbers):\n\n"
        f"{json.dumps(facts['bid'], sort_keys=True, default=str)}\n\n"
        f"Competitor: {json.dumps(facts['competitor'], sort_keys=True)}\n\n"
        f"Produce the postmortem JSON."
    )

    result = complete_json(
        model=get_settings().model_sonnet,
        system=SYSTEM_PROMPT,
        system_extra=[company_context],
        cache_system=True,
        user=user_msg,
        max_tokens=1500,
        temperature=0.2,
    )

    # Pin the price-gap dict so we don't rely on the LLM to copy it
    result["price_gap_analysis"] = {
        "our_price": our_price,
        "winning_price": winning_price,
        "delta_usd": delta_usd,
        "delta_pct": delta_pct,
        **{k: v for k, v in result.get("price_gap_analysis", {}).items()
           if k == "interpretation"},
    }

    if write_insight:
        headline = (
            f"Loss postmortem: {bid['client_name']} ({bid['service_line']}, "
            f"${our_price:,.0f})"
        )
        finding = "\n".join(
            f"- {r}" for r in result.get("likely_reasons", [])
        ) or result.get("pattern_across_recent_losses", "(no findings)")
        recommendation = "\n".join(
            f"- {r}" for r in result.get("recommendations_for_next_bid", [])
        ) or "(no recommendations)"
        projected = (
            f"Price delta {delta_pct}% vs {bid.get('outcome_competitor') or 'competitor'}"
            if delta_pct is not None else "Competitor price unknown"
        )
        execute(
            """
            INSERT INTO intelligence_insights (
                company_id, category, severity, headline, finding,
                recommendation, projected_impact, supporting_bids, status
            ) VALUES (%s, 'competitor', %s, %s, %s, %s, %s, %s, 'open')
            """,
            (
                bid["company_id"],
                {"high": "high", "medium": "medium", "low": "info"}.get(
                    result.get("confidence", "low"), "info"
                ),
                headline, finding, recommendation, projected,
                [bid_id],
            ),
        )
        audit_record(
            entity_type="bid",
            entity_id=bid_id,
            company_id=str(bid["company_id"]),
            action="postmortem",
            actor="postmortem_agent",
            diff={"confidence": result.get("confidence"),
                   "delta_pct": delta_pct},
        )

    result["_bid_id"] = bid_id
    return result
