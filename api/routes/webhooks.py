"""Payroll webhook receiver — spec Phase 2 trigger for JCR.

When ProService's payroll system completes a pay period that includes
allocations against one of our bids, it POSTs to /webhooks/payroll.
The handler:
  1. Verifies the HMAC signature (header X-ProService-Signature)
  2. Looks up the bid by external job_id
  3. Triggers reconcile_job() if the bid is in JOB_COMPLETE state

This is the integration point that closes the loop from spec §1.5:
"the Job-Cost Reconciliation agent compares what was quoted to what
the job actually cost via ProService payroll. Every completed job
updates the company's real-margin profile, which feeds back into the
next bid's Pricing agent."

The Phase-1 PoC simulates payroll via schedule_allocations. The
webhook is the seam where Phase 2 plugs in.
"""
from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter()


class PayrollAllocation(BaseModel):
    employee_id: UUID
    week_start_date: str  # ISO date
    allocated_hours: int
    trade_role: str | None = None


class PayrollCompletedPayload(BaseModel):
    """Posted by payroll when a pay period closes against a job."""

    company_id: UUID
    bid_id: UUID  # ProService payroll → ours via external_job_id mapping
    pay_period_end: str
    allocations: list[PayrollAllocation]
    actual_material_cost: float | None = None
    actual_other_costs: float = 0.0


def _verify_signature(body: bytes, signature_header: str | None) -> bool:
    """HMAC-SHA256 verification with the WEBHOOK_SECRET env var.

    Skips verification (with a warning) when no secret is configured —
    useful for local development. Production deploys MUST set
    WEBHOOK_SECRET.
    """
    import os

    secret = os.environ.get("PAYROLL_WEBHOOK_SECRET", "")
    if not secret:
        logger.warning("PAYROLL_WEBHOOK_SECRET not set — accepting unsigned webhook")
        return True
    if not signature_header:
        return False
    # Expected format: "sha256=<hex>"
    if not signature_header.startswith("sha256="):
        return False
    expected = signature_header[len("sha256="):]
    computed = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, computed)


@router.post("/payroll")
async def receive_payroll_webhook(
    request: Request,
    x_proservice_signature: str | None = Header(default=None),
) -> dict:
    body = await request.body()

    if not _verify_signature(body, x_proservice_signature):
        raise HTTPException(401, "invalid signature")

    try:
        payload = PayrollCompletedPayload.model_validate_json(body)
    except Exception as e:
        raise HTTPException(400, f"invalid payload: {e}")

    from agents import jcr, orchestrator
    from core.audit import record as audit_record
    from core.db import execute, fetch_one

    bid = fetch_one(
        "SELECT id, state FROM bids WHERE id = %s AND company_id = %s",
        (str(payload.bid_id), str(payload.company_id)),
    )
    if not bid:
        raise HTTPException(404, "bid not found")

    # Record the incoming payroll data as schedule_allocations rows so
    # the existing JCR code path picks them up.
    for alloc in payload.allocations:
        execute(
            """
            INSERT INTO schedule_allocations (
                employee_id, bid_id, company_id, week_start_date,
                allocated_hours, trade_role
            ) VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (
                str(alloc.employee_id),
                str(payload.bid_id),
                str(payload.company_id),
                alloc.week_start_date,
                alloc.allocated_hours,
                alloc.trade_role,
            ),
        )

    audit_record(
        entity_type="bid",
        entity_id=str(payload.bid_id),
        company_id=str(payload.company_id),
        action="payroll_received",
        actor="payroll_webhook",
        diff={
            "pay_period_end": payload.pay_period_end,
            "n_allocations": len(payload.allocations),
        },
    )

    # Auto-trigger reconciliation if the bid is at JOB_COMPLETE
    # (otherwise the human marks it complete later and reconciliation
    # runs then).
    if bid["state"] == "JOB_COMPLETE":
        recon = jcr.reconcile_job(
            payload.bid_id,
            actual_material_cost=payload.actual_material_cost,
            actual_other_costs=payload.actual_other_costs,
        )
        orchestrator.transition(
            payload.bid_id, "RECONCILED", "auto",
            f"payroll webhook for pay period {payload.pay_period_end}",
        )
        return {
            "received_at": datetime.utcnow().isoformat(),
            "bid_id": str(payload.bid_id),
            "action": "reconciled",
            "delivered_margin_pct": recon["delivered_margin_pct"],
        }

    return {
        "received_at": datetime.utcnow().isoformat(),
        "bid_id": str(payload.bid_id),
        "action": "allocations_recorded",
        "n_allocations": len(payload.allocations),
        "bid_state": bid["state"],
    }


@router.get("/payroll/health")
def webhook_health() -> dict:
    """Smoke endpoint for payroll integration health checks."""
    import os

    return {
        "ok": True,
        "signing_configured": bool(os.environ.get("PAYROLL_WEBHOOK_SECRET")),
    }
