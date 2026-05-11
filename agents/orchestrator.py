"""Orchestrator — spec §5.1 and §6.

Decomposes user intent into a workflow; routes between agents; manages bid
state via the state machine in core/states.py; merges agent outputs.

Pure orchestration: no LLM calls in the hot path of transitions (just rule-
based). The natural-language intent router is the one place Haiku is used.
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any
from uuid import UUID, uuid4

from core.anthropic_client import complete_json
from core.db import execute, fetch_one
from core.settings import get_settings
from core.states import BidState, can_transition, is_terminal

from agents import composition, follow_up, intake, jcr, pricing

logger = logging.getLogger(__name__)


# ─── State transition helpers ────────────────────────────────────


def _record_transition(
    bid_id: str, from_state: str | None, to_state: str,
    triggered_by: str, agent_call_id: str | None = None, notes: str = "",
) -> None:
    execute(
        """
        INSERT INTO bid_state_history (bid_id, from_state, to_state,
                                       triggered_by, agent_call_id, notes)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (bid_id, from_state, to_state, triggered_by, agent_call_id, notes),
    )


def transition(bid_id: UUID | str, to_state: BidState | str,
               triggered_by: str = "auto", notes: str = "") -> dict:
    """Transition a bid to a new state. Raises if transition is invalid."""
    bid_id = str(bid_id)
    target = to_state.value if isinstance(to_state, BidState) else to_state
    row = fetch_one("SELECT state FROM bids WHERE id = %s", (bid_id,))
    if not row:
        raise ValueError(f"bid {bid_id} not found")
    current = row["state"]
    if current == target:
        return {"bid_id": bid_id, "state": current, "noop": True}
    if not can_transition(current, target):
        raise ValueError(f"invalid transition {current} -> {target}")
    execute("UPDATE bids SET state = %s WHERE id = %s", (target, bid_id))
    _record_transition(bid_id, current, target, triggered_by, str(uuid4()), notes)
    return {"bid_id": bid_id, "from_state": current, "state": target}


# ─── Workflows ───────────────────────────────────────────────────


def create_bid(
    company_id: UUID | str,
    client_name: str,
    service_line: str,
    scope_summary: str,
    job_address: dict | None = None,
    client_segment: str = "repeat",
    estimated_start_date: date | None = None,
    bid_deadline: datetime | None = None,
) -> str:
    bid_id = str(uuid4())
    execute(
        """
        INSERT INTO bids (
            id, company_id, state, service_line, client_name, client_segment,
            scope_summary, job_address, estimated_start_date, bid_deadline
        ) VALUES (%s, %s, 'RFP_RECEIVED', %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            bid_id, str(company_id), service_line, client_name, client_segment,
            scope_summary, _json(job_address), estimated_start_date, bid_deadline,
        ),
    )
    _record_transition(bid_id, None, "RFP_RECEIVED", "create_bid", None,
                       "bid created from scope input")
    return bid_id


def run_assessment(bid_id: UUID | str, labor_plan: list[dict], material_quantity: float) -> dict:
    """RFP_RECEIVED -> ASSESSING -> (DRAFT_GENERATED | EXCLUSIONS_REVIEW).

    Fires Pricing then Composition. Decision between DRAFT_GENERATED and
    EXCLUSIONS_REVIEW depends on Composition's exclusions verification.
    """
    bid_id = str(bid_id)
    bid = fetch_one(
        """
        SELECT b.*, c.id AS company_id
        FROM bids b JOIN companies c ON c.id = b.company_id
        WHERE b.id = %s
        """,
        (bid_id,),
    )
    if not bid:
        raise ValueError(f"bid {bid_id} not found")
    if bid["state"] == BidState.RFP_RECEIVED.value:
        transition(bid_id, BidState.ASSESSING, "auto", "begin assessment")

    pricing_result = pricing.compute_pricing(
        company_id=bid["company_id"],
        service_line=bid["service_line"],
        labor_plan=labor_plan,
        material_quantity=material_quantity,
        estimated_start_date=bid["estimated_start_date"] or date.today(),
        client_segment=bid["client_segment"] or "repeat",
    )

    composition_result = composition.compose_bid(
        company_id=bid["company_id"],
        service_line=bid["service_line"],
        scope_summary=bid["scope_summary"] or "",
        client_name=bid["client_name"] or "",
        client_address=(bid.get("job_address") or {}).get("formatted", ""),
        pricing_breakdown=pricing_result,
    )

    # Persist pricing breakdown and exclusions analysis
    execute(
        """
        UPDATE bids
           SET pricing_breakdown = %s,
               estimated_value = %s,
               estimated_labor_hours = %s,
               capacity_at_quote = %s,
               exclusions_applied = %s,
               exclusions_missing = %s,
               draft_generated_at = NOW()
         WHERE id = %s
        """,
        (
            _json(pricing_result),
            pricing_result["target_price"],
            pricing_result["labor"]["total_hours"],
            pricing_result["capacity_utilization_at_start"],
            composition_result["exclusions_present"],
            composition_result["exclusions_missing"],
            bid_id,
        ),
    )

    if composition_result["exclusions_verified"]:
        transition(bid_id, BidState.DRAFT_GENERATED, "auto",
                   f"{composition_result['total_required']} exclusions verified present")
        next_state = BidState.DRAFT_GENERATED
    else:
        transition(bid_id, BidState.EXCLUSIONS_REVIEW, "auto",
                   f"missing: {composition_result['exclusions_missing']}")
        next_state = BidState.EXCLUSIONS_REVIEW

    return {
        "bid_id": bid_id,
        "state": next_state.value,
        "pricing": pricing_result,
        "composition": composition_result,
    }


def accept_exclusions(bid_id: UUID | str, accepted: list[str], skipped: list[str]) -> dict:
    """Human reviewed missing exclusions; route back to DRAFT_GENERATED."""
    bid_id = str(bid_id)
    execute(
        """
        UPDATE bids
           SET exclusions_applied = array_cat(COALESCE(exclusions_applied, '{}'), %s::text[]),
               exclusions_missing = %s::text[]
         WHERE id = %s
        """,
        (accepted, skipped, bid_id),
    )
    return transition(bid_id, BidState.DRAFT_GENERATED, "human",
                      f"accepted {len(accepted)}, skipped {len(skipped)}")


def submit_for_human_review(bid_id: UUID | str) -> dict:
    return transition(bid_id, BidState.HUMAN_REVIEW, "auto", "draft ready for review")


def send_bid(bid_id: UUID | str) -> dict:
    """HUMAN_REVIEW -> SENT, then schedule follow-ups per segment."""
    bid_id = str(bid_id)
    execute("UPDATE bids SET sent_at = NOW() WHERE id = %s", (bid_id,))
    result = transition(bid_id, BidState.SENT, "human", "bid sent to prospect")
    bid = fetch_one("SELECT client_segment FROM bids WHERE id = %s", (bid_id,))
    follow_up.schedule_follow_ups(bid_id, bid.get("client_segment") or "repeat")
    return result


def capture_outcome(bid_id: UUID | str, outcome: str, reason: str | None = None,
                    competitor: str | None = None, winning_bid: float | None = None) -> dict:
    """Capture WON / LOST / STALLED / NO_DECISION outcomes."""
    bid_id = str(bid_id)
    execute(
        """
        UPDATE bids
           SET outcome = %s, outcome_reason = %s, outcome_competitor = %s,
               outcome_winning_bid = %s, outcome_captured_at = NOW()
         WHERE id = %s
        """,
        (outcome, reason, competitor, winning_bid, bid_id),
    )
    target = {
        "WON": BidState.WON,
        "LOST": BidState.LOST,
        "STALLED": BidState.STALLED,
        "NO_DECISION": BidState.NO_DECISION,
    }.get(outcome)
    if target is None:
        raise ValueError(f"unknown outcome {outcome}")
    return transition(bid_id, target, "human", f"outcome captured: {outcome}")


def mark_job_started(bid_id: UUID | str) -> dict:
    return transition(bid_id, BidState.JOB_IN_PROGRESS, "auto",
                      "estimated_start_date reached")


def mark_job_complete(bid_id: UUID | str) -> dict:
    """Human marks the job complete; orchestrator immediately runs JCR."""
    bid_id = str(bid_id)
    transition(bid_id, BidState.JOB_COMPLETE, "human", "work delivered")
    recon = jcr.reconcile_job(bid_id)
    transition(bid_id, BidState.RECONCILED, "auto", "JCR computed delivered margin")
    return {"reconciliation": recon}


# ─── NL intent routing (Haiku) ─────────────────────────────────


_ROUTE_SYSTEM = """You classify a user message into one of these workflow intents
for a specialty contractor bid system. Return strict JSON.

Intents:
- create_bid: new RFP / scope arrived, want to start a bid
- run_assessment: bid exists, want to generate draft
- send_bid: human approves draft, send to prospect
- capture_outcome: prospect responded (won/lost/stalled)
- mark_job_complete: work delivered, run reconciliation
- ask_context: question about the company profile, history, exclusions
- run_intelligence: produce weekly insights

Return: {"intent": str, "confidence": number, "rationale": str}
"""


def classify_intent(message: str) -> dict:
    return complete_json(
        model=get_settings().model_haiku,
        system=_ROUTE_SYSTEM,
        user=f"User message: {message}\n\nReturn the JSON only.",
        max_tokens=256,
        temperature=0.0,
    )


# ─── Utilities ─────────────────────────────────────────────────


def _json(obj: Any) -> str | None:
    import json
    if obj is None:
        return None
    return json.dumps(obj, default=str)


def get_state_history(bid_id: UUID | str) -> list[dict]:
    from core.db import fetch_all
    return fetch_all(
        """
        SELECT from_state, to_state, triggered_by, notes, occurred_at
        FROM bid_state_history
        WHERE bid_id = %s
        ORDER BY occurred_at ASC
        """,
        (str(bid_id),),
    )


# Re-export the intake agent so the orchestrator's caller doesn't have to
# import agents.intake directly.
def run_intake(document_id: str, filename: str, text: str,
               document_type_hint: str | None = None) -> dict:
    return intake.run(document_id, filename, text, document_type_hint)
