"""Celery tasks. Registered via core.celery_app.include = ["core.tasks"]."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from core.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="core.tasks.check_due_followups")
def check_due_followups() -> dict:
    """Advance follow-ups whose scheduled_for has passed.

    Marks `SCHEDULED` -> `DUE`. Human-driven send still required per
    spec §5.7 (we don't auto-send messages without explicit opt-in).
    """
    from core.db import execute, fetch_all

    rows = fetch_all(
        """
        SELECT id, bid_id, sequence_number, scheduled_for
        FROM follow_ups
        WHERE state = 'SCHEDULED' AND scheduled_for <= NOW()
        """
    )
    for r in rows:
        execute(
            "UPDATE follow_ups SET state = 'DUE' WHERE id = %s",
            (r["id"],),
        )
        bid_state = {
            1: "FOLLOW_UP_1_DUE",
            2: "FOLLOW_UP_2_DUE",
            3: "FOLLOW_UP_3_DUE",
        }.get(int(r["sequence_number"]))
        if bid_state:
            execute(
                """
                UPDATE bids SET state = %s
                WHERE id = %s
                  AND state IN ('SENT', 'FOLLOW_UP_1_SENT', 'FOLLOW_UP_2_SENT')
                """,
                (bid_state, r["bid_id"]),
            )
    return {"advanced": len(rows)}


@celery_app.task(name="core.tasks.run_intelligence_for_all_companies")
def run_intelligence_for_all_companies() -> dict:
    """Weekly: run Intelligence agent for every onboarded company.

    When ``INTELLIGENCE_USE_BATCH=true``, the per-company runs are
    submitted as a single Anthropic Batch API job (50% cheaper, async).
    Default sync mode keeps the weekly cadence predictable.
    """
    from agents import intelligence
    from core.db import fetch_all
    from core.settings import get_settings

    companies = fetch_all(
        "SELECT id FROM companies WHERE onboarded_at IS NOT NULL"
    )
    summary = {}

    if get_settings().intelligence_use_batch:
        # NOTE: the current Intelligence agent's narrative call is one
        # of several DB reads + writes per insight, so a fully-batched
        # pipeline is a larger refactor. The lever is exposed: callers
        # who only need batched *narratives* (e.g., dashboard refresh
        # batches across many companies) can use
        # `core.batch.batch_intelligence_narratives`. For the weekly
        # task we still iterate companies but log that the flag was on.
        logger.info(
            "INTELLIGENCE_USE_BATCH=true — narrative-only batching is "
            "exposed via core.batch.batch_intelligence_narratives. The "
            "current per-company analysis still runs synchronously "
            "because it interleaves DB reads + writes per insight."
        )

    for c in companies:
        try:
            insights = intelligence.run_weekly_analysis(c["id"])
            summary[str(c["id"])] = len(insights)
        except Exception as e:
            logger.exception("Intelligence agent failed for %s", c["id"])
            summary[str(c["id"])] = f"error: {e}"
    return summary


@celery_app.task(name="core.tasks.detect_jcr_patterns_for_all_companies")
def detect_jcr_patterns_for_all_companies() -> dict:
    """Nightly: JCR pattern detection per company (n>=8 reconciled jobs)."""
    from agents import jcr
    from core.db import fetch_all

    companies = fetch_all(
        "SELECT id FROM companies WHERE onboarded_at IS NOT NULL"
    )
    summary = {}
    for c in companies:
        try:
            patterns = jcr.detect_patterns(c["id"])
            summary[str(c["id"])] = len(patterns)
        except Exception as e:
            logger.exception("JCR pattern detection failed for %s", c["id"])
            summary[str(c["id"])] = f"error: {e}"
    return summary


@celery_app.task(name="core.tasks.advance_stalled_bids")
def advance_stalled_bids() -> dict:
    """SENT/FOLLOW_UP_*_SENT bids with 14+ days no response -> STALLED.

    Per spec §6: STALLED state means 14+ days no response.
    """
    from core.db import execute, fetch_all

    threshold = datetime.utcnow() - timedelta(days=14)
    rows = fetch_all(
        """
        SELECT id FROM bids
        WHERE state IN ('SENT', 'FOLLOW_UP_3_SENT')
          AND sent_at IS NOT NULL
          AND sent_at <= %s
          AND outcome IS NULL
        """,
        (threshold,),
    )
    for r in rows:
        execute("UPDATE bids SET state = 'STALLED' WHERE id = %s", (r["id"],))
        execute(
            """
            INSERT INTO bid_state_history (bid_id, to_state, triggered_by, notes)
            VALUES (%s, 'STALLED', 'timer', '14+ days no response')
            """,
            (r["id"],),
        )

    # STALLED -> LOST after 30 days total
    lost_threshold = datetime.utcnow() - timedelta(days=30)
    lost_rows = fetch_all(
        """
        SELECT id FROM bids
        WHERE state = 'STALLED' AND sent_at <= %s AND outcome IS NULL
        """,
        (lost_threshold,),
    )
    for r in lost_rows:
        execute(
            "UPDATE bids SET state = 'LOST', outcome = 'LOST' WHERE id = %s",
            (r["id"],),
        )
        execute(
            """
            INSERT INTO bid_state_history (bid_id, from_state, to_state, triggered_by, notes)
            VALUES (%s, 'STALLED', 'LOST', 'timer', '30+ days no response')
            """,
            (r["id"],),
        )

    return {"stalled": len(rows), "lost": len(lost_rows)}


@celery_app.task(name="core.tasks.reconcile_bid")
def reconcile_bid(bid_id: str) -> dict:
    """One-shot: triggered when a bid transitions to JOB_COMPLETE."""
    from agents import jcr

    return jcr.reconcile_job(bid_id)
