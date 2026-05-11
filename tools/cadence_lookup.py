"""Follow-up cadence per spec §5.7.

Segment-aware: repeat_customer = single soft 5d touch (per Cavy);
cold_bidding / new = full 48hr / 5d / 10d sequence.
"""
from __future__ import annotations


def get_optimal_cadence(client_segment: str) -> list[dict]:
    if client_segment == "repeat":
        return [
            {
                "sequence_number": 1,
                "offset_hours": 24 * 5,
                "channel": "email",
                "tone": "soft, relationship-respecting",
            },
        ]
    # cold_lead, new, or unknown
    return [
        {"sequence_number": 1, "offset_hours": 48, "channel": "email", "tone": "warm check-in"},
        {"sequence_number": 2, "offset_hours": 24 * 5, "channel": "email", "tone": "direct"},
        {"sequence_number": 3, "offset_hours": 24 * 10, "channel": "email", "tone": "final, escalating"},
    ]
