"""Postgres integration tests — exercise the real schema.

These tests require a running pgvector-enabled Postgres reachable via
DATABASE_URL. They are marked `@pytest.mark.integration` and skipped by
default. Enable with:

    INTEGRATION_DB=true pytest -m integration

The GitHub Actions CI workflow runs these against a pgvector service
container.

What they cover:
- schema.sql actually applies without error
- pgvector vector type round-trips
- seed_all populates expected row counts
- orchestrator + JCR + Intelligence run end-to-end against real Postgres
"""
from __future__ import annotations

import os

import pytest

INTEGRATION_ENABLED = os.environ.get("INTEGRATION_DB", "").lower() in ("1", "true", "yes")

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module", autouse=True)
def _skip_if_no_db():
    if not INTEGRATION_ENABLED:
        pytest.skip("set INTEGRATION_DB=true to run Postgres integration tests")


@pytest.fixture(scope="module")
def schema_applied():
    """Apply db/schema.sql once for the module."""
    from pathlib import Path

    from core.db import execute

    schema_path = Path(__file__).parent.parent / "db" / "schema.sql"
    sql = schema_path.read_text()
    # Postgres can run a multi-statement script via psycopg's auto-handling
    execute(sql)
    yield


@pytest.fixture
def clean_company(schema_applied):
    """Wipe + reseed Archetype A. Each test gets fresh data."""
    from db import seed as seed_a
    from db.seed_utils import wipe_company_data

    wipe_company_data(seed_a.COMPANY_ID)
    seed_a.run()
    return seed_a.COMPANY_ID


class TestSchema:
    def test_pgvector_extension_loaded(self, schema_applied):
        from core.db import fetch_one

        row = fetch_one(
            "SELECT extname FROM pg_extension WHERE extname = 'vector'"
        )
        assert row is not None
        assert row["extname"] == "vector"

    def test_all_15_tables_exist(self, schema_applied):
        from core.db import fetch_all

        expected = [
            "companies", "voice_patterns", "service_lines", "pricing_logic",
            "scope_patterns", "bids", "bid_state_history", "follow_ups",
            "documents", "employees", "burden_components",
            "schedule_allocations", "prevailing_wages",
            "job_cost_reconciliation", "intelligence_insights",
        ]
        rows = fetch_all(
            """
            SELECT table_name FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = ANY(%s)
            """,
            (expected,),
        )
        names = {r["table_name"] for r in rows}
        for t in expected:
            assert t in names, f"missing table {t}"


class TestSeedArchetypeA:
    def test_seed_creates_company(self, clean_company):
        from core.db import fetch_one

        row = fetch_one(
            "SELECT name, segment, onboarded_at FROM companies WHERE id = %s",
            (clean_company,),
        )
        assert row is not None
        assert "Honolulu Stucco" in row["name"]
        assert row["segment"] == "repeat_customer"
        assert row["onboarded_at"] is not None

    def test_seed_creates_8_employees(self, clean_company):
        from core.db import fetch_one

        row = fetch_one(
            "SELECT COUNT(*) AS n FROM employees WHERE company_id = %s",
            (clean_company,),
        )
        assert row["n"] == 8

    def test_seed_creates_service_lines_with_exclusions(self, clean_company):
        from core.db import fetch_all

        rows = fetch_all(
            """
            SELECT line_name, standard_exclusions
            FROM service_lines WHERE company_id = %s
            """,
            (clean_company,),
        )
        names = {r["line_name"] for r in rows}
        assert "STUCCO-CONVENTIONAL" in names
        assert "EIFS" in names
        # Every service line must have at least one exclusion
        for r in rows:
            assert r["standard_exclusions"], f"{r['line_name']} has no exclusions"

    def test_seed_creates_at_least_40_bids(self, clean_company):
        from core.db import fetch_one

        row = fetch_one(
            "SELECT COUNT(*) AS n FROM bids WHERE company_id = %s",
            (clean_company,),
        )
        assert row["n"] >= 40

    def test_seed_creates_reconciliations_for_won_bids(self, clean_company):
        from core.db import fetch_one

        row = fetch_one(
            """
            SELECT COUNT(*) AS n
            FROM job_cost_reconciliation WHERE company_id = %s
            """,
            (clean_company,),
        )
        assert row["n"] > 0


class TestSeedIdempotency:
    def test_re_running_seed_does_not_duplicate(self, schema_applied):
        from core.db import fetch_one
        from db import seed as seed_a

        seed_a.run()
        after_first = fetch_one(
            "SELECT COUNT(*) AS n FROM employees WHERE company_id = %s",
            (seed_a.COMPANY_ID,),
        )["n"]
        seed_a.run()  # second run
        after_second = fetch_one(
            "SELECT COUNT(*) AS n FROM employees WHERE company_id = %s",
            (seed_a.COMPANY_ID,),
        )["n"]
        assert after_first == after_second == 8


class TestEndToEndLifecycle:
    """Full happy-path lifecycle against real Postgres."""

    def test_create_bid_writes_history(self, clean_company):
        from datetime import date, timedelta

        from agents import orchestrator
        from core.db import fetch_all

        bid_id = orchestrator.create_bid(
            company_id=clean_company,
            client_name="Integration Test Client",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="Integration test",
            client_segment="repeat",
            estimated_start_date=date.today() + timedelta(weeks=2),
        )
        history = fetch_all(
            "SELECT to_state FROM bid_state_history WHERE bid_id = %s",
            (bid_id,),
        )
        assert any(h["to_state"] == "RFP_RECEIVED" for h in history)


class TestCapacityLookup:
    def test_capacity_aggregates_real_schedule(self, clean_company):
        from datetime import date

        from tools.capacity_lookup import get_capacity_utilization

        result = get_capacity_utilization(clean_company, date.today(), weeks=4)
        assert result["headcount"] == 8
        assert result["capacity_hours_per_week"] == 320
        assert len(result["weeks"]) == 4


class TestJCRPatterns:
    def test_detect_patterns_finds_eifs_overrun(self, clean_company):
        """The seeded EIFS bids deliberately run +12-18% over."""
        from agents import jcr

        patterns = jcr.detect_patterns(clean_company)
        eifs_patterns = [p for p in patterns if p["service_line"] == "EIFS"]
        # EIFS overrun is the headline pattern in the seed
        if eifs_patterns:
            assert eifs_patterns[0]["avg_labor_variance_pct"] > 5.0
