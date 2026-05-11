"""Conversational interface: ask questions about a specific bid.

Spec doesn't include this — it's a UI affordance built on the existing
context store. The user picks a bid and chats with what amounts to a
specialized Context+Intelligence agent that has the bid's facts +
pricing breakdown + reconciliation loaded into the system prompt.

Compaction (Anthropic beta `compact-2026-01-12`) handles long
conversations: the API summarizes earlier context server-side when the
running total approaches the trigger threshold. Callers MUST append
`response.content` (full block list) back into messages on every turn
— extracting only `.text` would silently lose the compaction state and
break long sessions.
"""
from __future__ import annotations

import json
from typing import Any
from uuid import UUID

COMPACT_BETA_HEADER = "compact-2026-01-12"

SYSTEM_PROMPT = """You are a domain-specific assistant for a specialty
contractor. The user is asking questions about ONE specific bid; all
the facts about that bid (pricing breakdown, exclusions, capacity at
quote, outcome, and — when reconciled — actual labor hours and
delivered margin) are loaded into your context below.

Rules:
- Answer ONLY from the loaded facts. If something isn't in your
  context, say so explicitly. Do not speculate about industry norms
  or invent numbers.
- When asked about money, quote the exact figure from the facts.
- When asked about exclusions, list what was applied vs skipped — both
  are recorded.
- When asked "why did we lose" or "why is our margin off", reach for
  the patterns_across_recent_losses / variance_labor_hours_pct fields
  rather than guessing.
- Keep answers to 4-6 sentences unless the user asks for detail.
- If the user changes topics to something not about this bid, briefly
  note that you only have context for this one bid and offer to look
  up specific information they're after.
"""


def _load_bid_facts(bid_id: UUID | str) -> dict[str, Any]:
    """Snapshot everything the converse agent needs about one bid."""
    from core.db import fetch_all, fetch_one

    bid = fetch_one(
        """
        SELECT b.id, b.company_id, b.client_name, b.service_line,
               b.scope_summary, b.estimated_value, b.estimated_labor_hours,
               b.estimated_start_date, b.client_segment, b.state,
               b.capacity_at_quote, b.exclusions_applied,
               b.exclusions_missing, b.outcome, b.outcome_reason,
               b.outcome_competitor, b.outcome_winning_bid,
               b.actual_labor_hours, b.actual_cost_total,
               b.delivered_margin_pct, b.pricing_breakdown,
               c.name AS company_name
        FROM bids b JOIN companies c ON c.id = b.company_id
        WHERE b.id = %s
        """,
        (str(bid_id),),
    )
    if not bid:
        raise ValueError(f"bid {bid_id} not found")

    recon = fetch_one(
        """
        SELECT quoted_price, quoted_labor_hours, quoted_labor_cost,
               quoted_material_cost, actual_labor_hours,
               actual_labor_cost, actual_material_cost,
               delivered_margin_pct, variance_labor_hours_pct,
               variance_total_cost_pct, reconciled_at
        FROM job_cost_reconciliation
        WHERE bid_id = %s
        """,
        (str(bid_id),),
    )
    history = fetch_all(
        """
        SELECT from_state, to_state, triggered_by, notes, occurred_at
        FROM bid_state_history
        WHERE bid_id = %s
        ORDER BY occurred_at ASC
        """,
        (str(bid_id),),
    )
    return {"bid": bid, "reconciliation": recon, "state_history": history}


def _build_system_prompt(bid_id: UUID | str) -> str:
    facts = _load_bid_facts(bid_id)
    return (
        SYSTEM_PROMPT
        + "\n\n--- LOADED BID FACTS ---\n"
        + json.dumps(facts, default=str, sort_keys=True, indent=2)
    )


def initial_messages() -> list[dict]:
    """Start a fresh conversation. Returns empty messages list."""
    return []


def reply(
    bid_id: UUID | str,
    messages: list[dict],
    user_message: str,
    enable_compaction: bool = True,
) -> dict[str, Any]:
    """Append ``user_message``, call Claude, append the response.

    Args:
      bid_id: the bid being discussed (loads facts into system prompt)
      messages: the conversation so far (alternating user/assistant)
      user_message: the new user input
      enable_compaction: if True (default), the call uses the
        compact-2026-01-12 beta. Set False to test without it.

    Returns:
      {
        "messages": updated message list (with user + assistant turn appended),
        "assistant_text": str (extracted for convenience),
        "compaction_event": bool (True if the response stream had a
            compaction block — earlier history got summarized server-side),
      }

    The caller MUST persist ``messages`` between turns. Extracting only
    ``assistant_text`` and rebuilding the history from text would lose
    compaction state.
    """
    from core.anthropic_client import get_client
    from core.settings import get_settings

    system = _build_system_prompt(bid_id)
    new_messages = list(messages)
    new_messages.append({"role": "user", "content": user_message})

    client = get_client()
    kwargs: dict[str, Any] = {
        "model": get_settings().model_sonnet,
        "max_tokens": 1024,
        "system": system,
        "messages": new_messages,
    }
    if enable_compaction:
        # Use the beta endpoint when compaction is enabled
        resp = client.beta.messages.create(
            betas=[COMPACT_BETA_HEADER],
            context_management={"edits": [{"type": "compact_20260112"}]},
            **kwargs,
        )
    else:
        resp = client.messages.create(**kwargs)

    # CRITICAL: append the full content (list of blocks), not just text.
    # Compaction blocks must be preserved across turns.
    new_messages.append({"role": "assistant", "content": resp.content})

    text_parts = [
        block.text for block in resp.content
        if getattr(block, "type", None) == "text"
    ]
    compaction_event = any(
        getattr(block, "type", None) == "compaction"
        for block in resp.content
    )
    return {
        "messages": new_messages,
        "assistant_text": "".join(text_parts).strip(),
        "compaction_event": compaction_event,
    }
