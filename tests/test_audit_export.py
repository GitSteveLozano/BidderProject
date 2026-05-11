"""Audit log CSV export tests."""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest


def _audit_row(action, occurred_at=None, **overrides):
    base = {
        "occurred_at": occurred_at or datetime(2026, 5, 11, 12, 0, 0),
        "entity_type": "bid",
        "entity_id": "00000000-0000-0000-0000-000000000010",
        "company_id": "00000000-0000-0000-0000-000000000001",
        "action": action,
        "actor": "human",
        "request_id": "req-1",
        "agent_call_id": None,
        "diff": {"state": {"from": "RFP_RECEIVED", "to": "ASSESSING"}},
        "notes": "test",
    }
    base.update(overrides)
    return base


@pytest.fixture
def stub_rows(monkeypatch):
    """Replace core.db.fetch_all to return a fixed list of audit rows."""
    rows = [
        _audit_row("create"),
        _audit_row("transition",
                   occurred_at=datetime(2026, 5, 11, 12, 5, 0)),
        _audit_row("outcome",
                   diff={"outcome": "WON", "competitor": "Inex"}),
    ]
    captured = {"sql": None, "params": None}

    import core.db as core_db

    def fake_fetch_all(sql, params=None):
        captured["sql"] = sql
        captured["params"] = params
        return rows

    monkeypatch.setattr(core_db, "fetch_all", fake_fetch_all)
    return {"rows": rows, "captured": captured}


class TestRenderCsv:
    def test_headers_match_canonical_order(self):
        from core.audit_export import CSV_HEADERS, render_csv

        out = render_csv([])
        first_line = out.splitlines()[0]
        assert first_line.split(",") == CSV_HEADERS

    def test_diff_serialized_as_json_string(self):
        from core.audit_export import render_csv

        rows = [_audit_row("transition", diff={"k": "v"})]
        out = render_csv(rows)
        # diff column should contain the serialized JSON
        assert '{"k":' in out or '"{""k""' in out

    def test_iso_datetime_in_occurred_at_column(self):
        from core.audit_export import render_csv

        rows = [_audit_row("create",
                            occurred_at=datetime(2026, 5, 11, 9, 30, 0))]
        out = render_csv(rows)
        assert "2026-05-11T09:30:00" in out

    def test_row_count_matches_input(self):
        from core.audit_export import render_csv

        rows = [_audit_row("create"), _audit_row("transition")]
        out = render_csv(rows)
        # Header + 2 rows
        assert len(out.strip().splitlines()) == 3


class TestExportFilters:
    def test_company_id_filter_in_where(self, stub_rows):
        from core.audit_export import export_csv

        export_csv(company_id="00000000-0000-0000-0000-000000000001")
        sql = stub_rows["captured"]["sql"]
        assert "company_id = %s" in sql

    def test_since_until_in_where(self, stub_rows):
        from core.audit_export import export_csv

        since = datetime.utcnow() - timedelta(days=7)
        until = datetime.utcnow()
        export_csv(since=since, until=until)
        sql = stub_rows["captured"]["sql"]
        assert "occurred_at >= %s" in sql
        assert "occurred_at <= %s" in sql

    def test_entity_type_filter_in_where(self, stub_rows):
        from core.audit_export import export_csv

        export_csv(entity_type="reconciliation")
        sql = stub_rows["captured"]["sql"]
        assert "entity_type = %s" in sql

    def test_no_filters_uses_1_eq_1(self, stub_rows):
        from core.audit_export import export_csv

        export_csv()
        sql = stub_rows["captured"]["sql"]
        assert "WHERE 1=1" in sql

    def test_returns_csv_body_with_rows(self, stub_rows):
        from core.audit_export import export_csv

        body = export_csv(company_id="x")
        assert "create" in body
        assert "transition" in body
        assert "outcome" in body


class TestExportApiRoute:
    def test_export_endpoint_returns_csv(self, monkeypatch):
        pytest.importorskip("fastapi")
        from fastapi.testclient import TestClient

        from api.main import app

        # Patch the export module to avoid DB
        import core.audit_export as ae

        monkeypatch.setattr(
            ae, "export_csv",
            lambda *a, **kw: "occurred_at,entity_type\n2026-05-11,bid\n",
        )
        client = TestClient(app)
        r = client.get("/audit/export.csv")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/csv")
        assert "attachment" in r.headers.get("content-disposition", "")
        assert "occurred_at,entity_type" in r.text
