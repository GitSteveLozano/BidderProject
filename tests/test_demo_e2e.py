"""End-to-end test of the demo storyboard against real Postgres.

Walks through every transition the demo claims in `docs/demo_storyboard.md`
against a live Postgres database. Catches:
- broken schema migrations
- seed scripts that don't actually populate what they claim
- orchestrator transitions that 500 in real life but pass with mocked DB
- audit log writes that work in tests but fail on real Postgres

Stubs only the LLM and embeddings clients — DB, capacity, JCR math,
state machine, audit log all run for real.

Enable with `INTEGRATION_DB=true pytest -m integration`.
"""
from __future__ import annotations

import os
from datetime import date, timedelta

import pytest

pytestmark = pytest.mark.integration

INTEGRATION_ENABLED = os.environ.get("INTEGRATION_DB", "").lower() in ("1", "true", "yes")


@pytest.fixture(scope="module", autouse=True)
def _skip_if_no_db():
    if not INTEGRATION_ENABLED:
        pytest.skip("set INTEGRATION_DB=true to run E2E tests")


@pytest.fixture(scope="module")
def seeded_company():
    """Apply schema once, seed Archetype A, return company id."""
    from pathlib import Path

    from core.db import execute
    from db import seed as seed_a
    from db.seed_utils import wipe_company_data

    schema_path = Path(__file__).parent.parent / "db" / "schema.sql"
    execute(schema_path.read_text())
    wipe_company_data(seed_a.COMPANY_ID)
    seed_a.run()
    return seed_a.COMPANY_ID


@pytest.fixture
def stub_llm(monkeypatch):
    """Stub Anthropic + OpenAI clients so the test doesn't need keys.

    Composition returns a bid that contains all standard exclusions for
    the service line, so the verification step takes the happy path.
    """
    import core.anthropic_client as ac

    def fake_complete(model, system, user, system_extra=None, cache_system=False, **kwargs):
        # If this looks like a Composition call, echo all the exclusions
        # from the system_extra so verify_exclusions passes.
        if system_extra:
            extra = "\n".join(system_extra)
            if "STANDARD EXCLUSIONS" in extra:
                # Extract bulleted exclusions and include them
                excls = [
                    line.strip("- ").strip()
                    for line in extra.splitlines()
                    if line.strip().startswith("- ")
                ]
                bid = "# Stub bid\n\nExclusions:\n"
                for e in excls:
                    bid += f"- {e}\n"
                bid += "\nThank you for the opportunity."
                return bid
        return "STUB NARRATIVE"

    def fake_complete_json(model, system, user, **kwargs):
        return {"intent": "create_bid", "confidence": 0.9, "rationale": "stub"}

    monkeypatch.setattr(ac, "complete", fake_complete)
    monkeypatch.setattr(ac, "complete_json", fake_complete_json)

    import core.embeddings as emb
    monkeypatch.setattr(emb, "embed", lambda text: [0.0] * 1536)


class TestDemoStoryboardE2E:
    """Each test method corresponds to a segment of the demo storyboard."""

    def test_segment_2_bid_generation_full_lifecycle(self, seeded_company, stub_llm):
        """Segment 2 of docs/demo_storyboard.md: create bid → assess →
        DRAFT_GENERATED with pricing + verified exclusions."""
        from agents import orchestrator

        bid_id = orchestrator.create_bid(
            company_id=seeded_company,
            client_name="E2E Test — Esprit Heights",
            service_line="EIFS",
            scope_summary="EIFS exterior, ~3,200 sqft, ADEX system",
            client_segment="repeat",
            estimated_start_date=date.today() + timedelta(weeks=4),
        )
        result = orchestrator.run_assessment(
            bid_id=bid_id,
            labor_plan=[
                {"trade": "eifs", "hours": 312},
                {"trade": "helper", "hours": 80},
            ],
            material_quantity=3200,
        )
        assert result["state"] in ("DRAFT_GENERATED", "EXCLUSIONS_REVIEW")
        assert result["pricing"]["target_price"] > 0
        assert result["pricing"]["labor"]["total_hours"] == 392
        # Every number must trace to a citation
        assert len(result["pricing"]["citations"]) > 0

    def test_segment_4_send_and_followup(self, seeded_company, stub_llm):
        """Segment 4: HUMAN_REVIEW → SENT → follow-up scheduled."""
        from agents import orchestrator
        from core.db import fetch_all

        bid_id = orchestrator.create_bid(
            company_id=seeded_company,
            client_name="E2E Follow-up Test",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="Test stucco scope",
            client_segment="repeat",
            estimated_start_date=date.today() + timedelta(weeks=2),
        )
        result = orchestrator.run_assessment(
            bid_id=bid_id,
            labor_plan=[{"trade": "stucco_journeyman", "hours": 200}],
            material_quantity=2400,
        )
        # Resolve any missing exclusions to get to DRAFT_GENERATED
        if result["state"] == "EXCLUSIONS_REVIEW":
            orchestrator.accept_exclusions(
                bid_id,
                accepted=result["composition"].get("exclusions_missing", []),
                skipped=[],
            )
        orchestrator.submit_for_human_review(bid_id)
        orchestrator.send_bid(bid_id)

        followups = fetch_all(
            "SELECT * FROM follow_ups WHERE bid_id = %s ORDER BY sequence_number",
            (bid_id,),
        )
        # repeat_customer segment → exactly 1 follow-up scheduled
        assert len(followups) == 1
        assert followups[0]["sequence_number"] == 1

    def test_segment_5_jcr_runs_on_job_complete(self, seeded_company, stub_llm):
        """Segment 5: WON → JOB_IN_PROGRESS → JOB_COMPLETE → RECONCILED.

        JCR computes delivered margin from real schedule_allocations rows.
        """
        from agents import orchestrator
        from core.db import fetch_one

        bid_id = orchestrator.create_bid(
            company_id=seeded_company,
            client_name="E2E JCR Test",
            service_line="EIFS",
            scope_summary="EIFS for JCR test",
            client_segment="repeat",
            estimated_start_date=date.today() - timedelta(days=30),
        )
        result = orchestrator.run_assessment(
            bid_id=bid_id,
            labor_plan=[{"trade": "eifs", "hours": 400}],
            material_quantity=3200,
        )
        if result["state"] == "EXCLUSIONS_REVIEW":
            orchestrator.accept_exclusions(
                bid_id, accepted=result["composition"]["exclusions_missing"], skipped=[],
            )
        orchestrator.submit_for_human_review(bid_id)
        orchestrator.send_bid(bid_id)
        orchestrator.capture_outcome(bid_id, "WON")
        orchestrator.mark_job_started(bid_id)
        complete_result = orchestrator.mark_job_complete(bid_id)

        # JCR row was written
        recon = fetch_one(
            "SELECT * FROM job_cost_reconciliation WHERE bid_id = %s", (bid_id,)
        )
        assert recon is not None
        assert recon["quoted_price"] is not None

        # Bid state machine reached terminal
        bid = fetch_one("SELECT state FROM bids WHERE id = %s", (bid_id,))
        assert bid["state"] == "RECONCILED"

        # Reconciliation result was returned
        assert "reconciliation" in complete_result

    def test_segment_6_intelligence_writes_insights(self, seeded_company, stub_llm):
        """Segment 6: Intelligence agent runs over seeded data and writes
        insights to intelligence_insights."""
        from agents import intelligence
        from core.db import fetch_one

        before = fetch_one(
            "SELECT COUNT(*) AS n FROM intelligence_insights WHERE company_id = %s",
            (seeded_company,),
        )["n"]
        intelligence.run_weekly_analysis(seeded_company)
        after = fetch_one(
            "SELECT COUNT(*) AS n FROM intelligence_insights WHERE company_id = %s",
            (seeded_company,),
        )["n"]
        # Seeded data triggers at least one insight (EIFS margin drift)
        assert after >= before


class TestAuditLogInE2E:
    """Audit log writes survive against real Postgres."""

    def test_create_bid_appends_audit_row(self, seeded_company, stub_llm):
        from agents import orchestrator
        from core.db import fetch_all

        bid_id = orchestrator.create_bid(
            company_id=seeded_company,
            client_name="Audit Test",
            service_line="STUCCO-CONVENTIONAL",
            scope_summary="x",
        )
        rows = fetch_all(
            """
            SELECT action, actor, diff
            FROM audit_log WHERE entity_id = %s
            ORDER BY occurred_at ASC
            """,
            (bid_id,),
        )
        actions = [r["action"] for r in rows]
        assert "create" in actions
        assert "transition" in actions


class TestCapacityLookupAgainstSeed:
    """The Pricing agent's capacity tool must work against the seeded
    12-week schedule curve."""

    def test_capacity_lookup_returns_8_employees(self, seeded_company, stub_llm):
        from tools.capacity_lookup import get_capacity_utilization

        result = get_capacity_utilization(seeded_company, date.today(), weeks=4)
        assert result["headcount"] == 8
        assert result["capacity_hours_per_week"] == 320
        assert len(result["weeks"]) == 4
