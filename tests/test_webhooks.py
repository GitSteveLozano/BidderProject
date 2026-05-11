"""Payroll webhook receiver tests.

Spec Phase 2 integration point. Tests cover:
  - HMAC signature verification (accept signed, reject unsigned-when-configured)
  - Payload validation (400 on malformed)
  - Bid lookup (404 on unknown)
  - Schedule allocations recorded
  - Auto-trigger reconciliation when bid is at JOB_COMPLETE
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from uuid import uuid4

import pytest


@pytest.fixture
def client(mock_db):
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    from api.main import app

    return TestClient(app)


def _payload(bid_id, company_id, state_override=None):
    return {
        "company_id": company_id,
        "bid_id": bid_id,
        "pay_period_end": "2026-06-30",
        "allocations": [
            {"employee_id": str(uuid4()), "week_start_date": "2026-06-23",
             "allocated_hours": 40, "trade_role": "eifs_installer"},
            {"employee_id": str(uuid4()), "week_start_date": "2026-06-30",
             "allocated_hours": 32, "trade_role": "helper"},
        ],
        "actual_material_cost": 38500.0,
        "actual_other_costs": 0.0,
    }


def _sign(body: bytes, secret: str) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


class TestWebhookHealth:
    def test_health_endpoint(self, client):
        r = client.get("/webhooks/payroll/health")
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert "signing_configured" in body


class TestSignatureVerification:
    def test_unsigned_accepted_when_secret_unset(self, client, mock_db, monkeypatch):
        monkeypatch.delenv("PAYROLL_WEBHOOK_SECRET", raising=False)
        bid_id = str(uuid4())
        company_id = "00000000-0000-0000-0000-000000000001"
        mock_db["bid_row"]["id"] = bid_id
        mock_db["bid_state"] = "JOB_IN_PROGRESS"
        r = client.post("/webhooks/payroll", json=_payload(bid_id, company_id))
        # 404 because mock_db doesn't have the row, but signature passes
        assert r.status_code in (200, 404)

    def test_signed_request_accepted(self, client, mock_db, monkeypatch):
        secret = "test_secret_value"
        monkeypatch.setenv("PAYROLL_WEBHOOK_SECRET", secret)
        bid_id = str(uuid4())
        company_id = "00000000-0000-0000-0000-000000000001"
        payload = _payload(bid_id, company_id)
        body = json.dumps(payload).encode()
        # 404 because mock_db doesn't simulate the row, but signature path runs
        r = client.post(
            "/webhooks/payroll",
            content=body,
            headers={
                "X-ProService-Signature": _sign(body, secret),
                "Content-Type": "application/json",
            },
        )
        assert r.status_code in (200, 404)

    def test_unsigned_rejected_when_secret_set(self, client, monkeypatch):
        monkeypatch.setenv("PAYROLL_WEBHOOK_SECRET", "test_secret")
        bid_id = str(uuid4())
        company_id = "00000000-0000-0000-0000-000000000001"
        r = client.post("/webhooks/payroll", json=_payload(bid_id, company_id))
        assert r.status_code == 401

    def test_wrong_signature_rejected(self, client, monkeypatch):
        monkeypatch.setenv("PAYROLL_WEBHOOK_SECRET", "real_secret")
        bid_id = str(uuid4())
        company_id = "00000000-0000-0000-0000-000000000001"
        payload = _payload(bid_id, company_id)
        body = json.dumps(payload).encode()
        wrong_signature = _sign(body, "wrong_secret")
        r = client.post(
            "/webhooks/payroll",
            content=body,
            headers={
                "X-ProService-Signature": wrong_signature,
                "Content-Type": "application/json",
            },
        )
        assert r.status_code == 401


class TestPayloadValidation:
    def test_malformed_json_returns_400(self, client, monkeypatch):
        monkeypatch.delenv("PAYROLL_WEBHOOK_SECRET", raising=False)
        r = client.post(
            "/webhooks/payroll",
            content=b"this is not json",
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 400

    def test_missing_required_field_returns_400(self, client, monkeypatch):
        monkeypatch.delenv("PAYROLL_WEBHOOK_SECRET", raising=False)
        r = client.post(
            "/webhooks/payroll",
            json={"company_id": str(uuid4())},  # missing bid_id, etc.
        )
        assert r.status_code == 400

    def test_unknown_bid_returns_404(self, client, mock_db, monkeypatch):
        monkeypatch.delenv("PAYROLL_WEBHOOK_SECRET", raising=False)
        # mock_db's fetch_one returns the bid row regardless of params,
        # so override it for this test
        import core.db as core_db

        monkeypatch.setattr(core_db, "fetch_one", lambda sql, params=None: None)
        bid_id = str(uuid4())
        company_id = "00000000-0000-0000-0000-000000000001"
        r = client.post("/webhooks/payroll", json=_payload(bid_id, company_id))
        assert r.status_code == 404


class TestAllocationsRecorded:
    def test_allocations_inserted_for_in_progress_job(
        self, client, mock_db, monkeypatch
    ):
        """When the bid is JOB_IN_PROGRESS (not yet complete), the
        webhook records allocations but does NOT trigger reconciliation."""
        monkeypatch.delenv("PAYROLL_WEBHOOK_SECRET", raising=False)
        bid_id = str(uuid4())
        company_id = "00000000-0000-0000-0000-000000000001"

        executes: list[tuple] = []
        import core.db as core_db

        def fake_fetch_one(sql, params=None):
            return {"id": bid_id, "state": "JOB_IN_PROGRESS"}

        def fake_execute(sql, params=None):
            executes.append((sql, params))

        monkeypatch.setattr(core_db, "fetch_one", fake_fetch_one)
        monkeypatch.setattr(core_db, "execute", fake_execute)

        r = client.post("/webhooks/payroll", json=_payload(bid_id, company_id))
        assert r.status_code == 200
        body = r.json()
        assert body["action"] == "allocations_recorded"
        assert body["n_allocations"] == 2

        # Two INSERTs into schedule_allocations
        alloc_inserts = [e for e in executes if "schedule_allocations" in e[0]]
        assert len(alloc_inserts) == 2


class TestAutoReconcile:
    def test_completed_bid_triggers_jcr_and_transitions_to_reconciled(
        self, client, mock_db, monkeypatch
    ):
        monkeypatch.delenv("PAYROLL_WEBHOOK_SECRET", raising=False)
        bid_id = str(uuid4())
        company_id = "00000000-0000-0000-0000-000000000001"

        import core.db as core_db

        monkeypatch.setattr(
            core_db, "fetch_one",
            lambda sql, params=None: {"id": bid_id, "state": "JOB_COMPLETE"},
        )
        monkeypatch.setattr(core_db, "execute", lambda sql, params=None: None)

        # Stub the JCR + orchestrator
        from agents import jcr, orchestrator

        called: dict = {}

        def fake_reconcile(bid_id, actual_material_cost=None, actual_other_costs=0.0):
            called["reconcile"] = {"bid_id": str(bid_id),
                                    "material": actual_material_cost}
            return {"delivered_margin_pct": 28.5, "bid_id": str(bid_id)}

        def fake_transition(bid_id, to_state, triggered_by="auto", notes=""):
            called["transition"] = (str(bid_id), to_state, triggered_by)
            return {"state": to_state}

        monkeypatch.setattr(jcr, "reconcile_job", fake_reconcile)
        monkeypatch.setattr(orchestrator, "transition", fake_transition)

        r = client.post("/webhooks/payroll", json=_payload(bid_id, company_id))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["action"] == "reconciled"
        assert body["delivered_margin_pct"] == 28.5
        assert "reconcile" in called
        assert "transition" in called
        assert called["transition"][1] == "RECONCILED"
