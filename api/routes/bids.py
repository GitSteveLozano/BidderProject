"""Bid lifecycle routes."""
from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class BidCreate(BaseModel):
    company_id: UUID
    client_name: str
    service_line: str
    scope_summary: str
    job_address: dict | None = None
    client_segment: str = "repeat"
    estimated_start_date: date | None = None
    bid_deadline: datetime | None = None


class LaborItem(BaseModel):
    trade: str
    hours: float


class AssessmentIn(BaseModel):
    labor_plan: list[LaborItem]
    material_quantity: float


@router.get("/")
def list_bids(company_id: UUID, state: str | None = None) -> list[dict]:
    from core.db import fetch_all

    if state:
        return fetch_all(
            """
            SELECT id, state, client_name, service_line, estimated_value,
                   estimated_start_date, created_at
            FROM bids WHERE company_id = %s AND state = %s
            ORDER BY created_at DESC
            """,
            (str(company_id), state),
        )
    return fetch_all(
        """
        SELECT id, state, client_name, service_line, estimated_value,
               estimated_start_date, outcome, delivered_margin_pct, created_at
        FROM bids WHERE company_id = %s ORDER BY created_at DESC
        """,
        (str(company_id),),
    )


@router.post("/")
def create_bid(payload: BidCreate) -> dict:
    from agents import orchestrator

    bid_id = orchestrator.create_bid(
        company_id=payload.company_id,
        client_name=payload.client_name,
        service_line=payload.service_line,
        scope_summary=payload.scope_summary,
        job_address=payload.job_address,
        client_segment=payload.client_segment,
        estimated_start_date=payload.estimated_start_date,
        bid_deadline=payload.bid_deadline,
    )
    return {"bid_id": bid_id, "state": "RFP_RECEIVED"}


@router.get("/{bid_id}")
def get_bid(bid_id: UUID) -> dict:
    from agents import orchestrator
    from core.db import fetch_one

    bid = fetch_one("SELECT * FROM bids WHERE id = %s", (str(bid_id),))
    if not bid:
        raise HTTPException(404, "bid not found")
    history = orchestrator.get_state_history(bid_id)
    return {"bid": bid, "history": history}


@router.post("/{bid_id}/assess")
def assess(bid_id: UUID, payload: AssessmentIn) -> dict:
    from agents import orchestrator

    return orchestrator.run_assessment(
        bid_id=bid_id,
        labor_plan=[lp.model_dump() for lp in payload.labor_plan],
        material_quantity=payload.material_quantity,
    )


class ExclusionsDecision(BaseModel):
    accepted: list[str] = []
    skipped: list[str] = []


@router.post("/{bid_id}/exclusions-decision")
def exclusions_decision(bid_id: UUID, payload: ExclusionsDecision) -> dict:
    from agents import orchestrator

    return orchestrator.accept_exclusions(bid_id, payload.accepted, payload.skipped)


@router.post("/{bid_id}/submit-for-review")
def submit_for_review(bid_id: UUID) -> dict:
    from agents import orchestrator

    return orchestrator.submit_for_human_review(bid_id)


@router.post("/{bid_id}/send")
def send(bid_id: UUID) -> dict:
    from agents import orchestrator

    return orchestrator.send_bid(bid_id)


class OutcomeIn(BaseModel):
    outcome: str  # WON | LOST | STALLED | NO_DECISION
    reason: str | None = None
    competitor: str | None = None
    winning_bid: float | None = None


@router.post("/{bid_id}/outcome")
def outcome(bid_id: UUID, payload: OutcomeIn) -> dict:
    from agents import orchestrator

    return orchestrator.capture_outcome(
        bid_id,
        payload.outcome,
        reason=payload.reason,
        competitor=payload.competitor,
        winning_bid=payload.winning_bid,
    )


@router.post("/{bid_id}/start-job")
def start_job(bid_id: UUID) -> dict:
    from agents import orchestrator

    return orchestrator.mark_job_started(bid_id)


@router.post("/{bid_id}/complete-job")
def complete_job(bid_id: UUID) -> dict:
    from agents import orchestrator

    return orchestrator.mark_job_complete(bid_id)


@router.get("/{bid_id}/reconciliation")
def get_reconciliation(bid_id: UUID) -> dict:
    from core.db import fetch_one

    row = fetch_one(
        "SELECT * FROM job_cost_reconciliation WHERE bid_id = %s", (str(bid_id),)
    )
    if not row:
        raise HTTPException(404, "no reconciliation for this bid")
    return row


class FollowUpDraftIn(BaseModel):
    sequence_number: int


@router.post("/{bid_id}/follow-up/draft")
def draft_follow_up(bid_id: UUID, payload: FollowUpDraftIn) -> dict:
    from agents import follow_up

    return follow_up.draft_message(bid_id, payload.sequence_number)


@router.get("/{bid_id}/follow-ups")
def list_follow_ups(bid_id: UUID) -> list[dict]:
    from core.db import fetch_all

    return fetch_all(
        """
        SELECT id, sequence_number, scheduled_for, state, channel,
               draft_message, sent_at
        FROM follow_ups WHERE bid_id = %s ORDER BY sequence_number ASC
        """,
        (str(bid_id),),
    )
