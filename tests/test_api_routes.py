"""FastAPI route smoke tests.

Use the TestClient + mock_db fixture to exercise route handlers without
a real database. These are integration-shaped — they verify routing,
request validation, and the agent invocation glue work together.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

import pytest


@pytest.fixture
def client(mock_db):
    """TestClient with mocked DB. Returns FastAPI TestClient instance."""
    pytest.importorskip("fastapi")
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient

    from api.main import app

    return TestClient(app)


class TestHealth:
    def test_root_returns_ok(self, client):
        r = client.get("/")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


class TestCompanies:
    def test_list_companies(self, client, mock_db):
        # Override fetch_all to return a stub list of companies
        import core.db as core_db

        def fetch_all(sql, params=None):
            if "from companies" in sql.lower():
                return [
                    {"id": "c1", "name": "Honolulu Stucco", "segment": "repeat_customer",
                     "onboarded_at": None},
                ]
            return []

        core_db.fetch_all = fetch_all
        r = client.get("/companies/")
        assert r.status_code == 200
        assert r.json()[0]["name"] == "Honolulu Stucco"

    def test_get_company_404_when_not_found(self, client, monkeypatch):
        from agents import context as context_agent

        monkeypatch.setattr(
            context_agent, "get_company_profile",
            lambda cid: {"company": None, "voice_patterns": None,
                         "service_lines": [], "pricing_logic": None, "scope_patterns": None},
        )
        r = client.get("/companies/00000000-0000-0000-0000-000000000001")
        assert r.status_code == 404


class TestBids:
    def test_create_bid_returns_uuid_and_state(self, client, mock_db):
        r = client.post(
            "/bids/",
            json={
                "company_id": "00000000-0000-0000-0000-000000000001",
                "client_name": "Test Client",
                "service_line": "STUCCO-CONVENTIONAL",
                "scope_summary": "Test scope",
                "client_segment": "repeat",
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "bid_id" in body
        assert body["state"] == "RFP_RECEIVED"

    def test_create_bid_validates_required_fields(self, client):
        r = client.post("/bids/", json={"client_name": "x"})  # missing company_id
        assert r.status_code == 422

    def test_capture_outcome_routes_to_state(self, client, mock_db):
        mock_db["bid_state"] = "SENT"
        r = client.post(
            "/bids/11111111-1111-1111-1111-111111111111/outcome",
            json={"outcome": "WON"},
        )
        assert r.status_code == 200
        assert r.json()["state"] == "WON"

    def test_capture_outcome_rejects_unknown(self, client, mock_db):
        mock_db["bid_state"] = "SENT"
        # Orchestrator raises ValueError on unknown outcome.
        # TestClient propagates app exceptions by default.
        with pytest.raises(ValueError, match="unknown outcome"):
            client.post(
                "/bids/11111111-1111-1111-1111-111111111111/outcome",
                json={"outcome": "BANANA"},
            )


class TestIntelligence:
    def test_run_analysis_endpoint(self, client, monkeypatch):
        from agents import intelligence

        monkeypatch.setattr(
            intelligence, "run_weekly_analysis",
            lambda c: [{"category": "capacity", "headline": "Stub insight"}],
        )
        r = client.post("/intelligence/00000000-0000-0000-0000-000000000001/run")
        assert r.status_code == 200
        body = r.json()
        assert body["count"] == 1
        assert body["generated"][0]["category"] == "capacity"

    def test_capacity_forecast_endpoint(self, client, monkeypatch):
        from tools import capacity_lookup

        monkeypatch.setattr(
            capacity_lookup, "get_capacity_utilization",
            lambda c, s, weeks: {
                "company_id": str(c),
                "headcount": 8,
                "capacity_hours_per_week": 320,
                "avg_utilization": 0.78,
                "weeks": [],
                "citation": "stub",
            },
        )
        r = client.get(
            "/intelligence/00000000-0000-0000-0000-000000000001/capacity"
        )
        assert r.status_code == 200
        assert r.json()["avg_utilization"] == 0.78
