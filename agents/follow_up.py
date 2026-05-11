"""Follow-up agent — spec §5.7.

Segment-aware: repeat_customer = single soft 5d touch; cold_bidding / new
= full 3-touch 48hr / 5d / 10d sequence.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta
from uuid import UUID

from core.anthropic_client import complete
from core.db import execute, fetch_one
from core.settings import get_settings
from tools.cadence_lookup import get_optimal_cadence


def schedule_follow_ups(bid_id: UUID | str, client_segment: str = "repeat") -> list[dict]:
    """Schedule the segment-appropriate sequence of follow-ups."""
    bid_id = str(bid_id)
    cadence = get_optimal_cadence(client_segment)
    sent_at = datetime.utcnow()
    scheduled = []
    for step in cadence:
        when = sent_at + timedelta(hours=step["offset_hours"])
        execute(
            """
            INSERT INTO follow_ups (bid_id, sequence_number, scheduled_for, state, channel)
            VALUES (%s, %s, %s, 'SCHEDULED', %s)
            """,
            (bid_id, step["sequence_number"], when, step["channel"]),
        )
        scheduled.append(
            {
                "sequence_number": step["sequence_number"],
                "scheduled_for": when.isoformat(),
                "channel": step["channel"],
                "tone": step["tone"],
            }
        )
    return scheduled


def draft_message(bid_id: UUID | str, sequence_number: int) -> dict:
    """Draft a follow-up in the company's voice for the given sequence step."""
    bid_id = str(bid_id)
    bid = fetch_one(
        """
        SELECT b.client_name, b.client_segment, b.scope_summary,
               b.estimated_value, b.sent_at, c.name AS company_name,
               vp.tone, vp.boilerplate_closing
        FROM bids b
        JOIN companies c ON c.id = b.company_id
        LEFT JOIN voice_patterns vp ON vp.company_id = b.company_id
        WHERE b.id = %s
        """,
        (bid_id,),
    )
    if not bid:
        raise ValueError(f"bid {bid_id} not found")
    cadence = get_optimal_cadence(bid["client_segment"] or "repeat")
    step = next((s for s in cadence if s["sequence_number"] == sequence_number), None)
    if step is None:
        raise ValueError(f"no cadence step {sequence_number} for segment {bid['client_segment']}")

    facts = {
        "company_name": bid["company_name"],
        "client_name": bid["client_name"],
        "scope_summary": (bid["scope_summary"] or "")[:400],
        "quote_value": float(bid["estimated_value"] or 0),
        "tone": step["tone"],
        "voice_tone": bid.get("tone"),
        "boilerplate_closing": bid.get("boilerplate_closing"),
        "sequence_number": sequence_number,
    }

    draft = complete(
        model=get_settings().model_sonnet,
        system=(
            "You draft short, professional follow-up emails for a specialty "
            "contractor. The tone parameter is authoritative — match it. Keep "
            "messages under 8 sentences. Reference the specific project. Do not "
            "be pushy or use marketing language. End with the company's "
            "boilerplate closing if provided."
        ),
        user=f"Facts: {json.dumps(facts, default=str)}\n\nWrite the email (subject line + body).",
        max_tokens=512,
        temperature=0.5,
    )
    execute(
        """
        UPDATE follow_ups
           SET draft_message = %s
         WHERE bid_id = %s AND sequence_number = %s
        """,
        (draft, bid_id, sequence_number),
    )
    return {"sequence_number": sequence_number, "draft": draft}
