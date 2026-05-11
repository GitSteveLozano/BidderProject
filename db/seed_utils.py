"""Shared seed utilities.

Idempotency helper: seeds should be safe to re-run. Each archetype seed
calls `wipe_company_data(company_id)` before re-inserting so multiple
runs don't accumulate duplicate employees, bids, or schedule rows.

This wipes only data for the given company_id — multi-archetype DBs are
preserved correctly when one archetype is re-seeded.
"""
from __future__ import annotations

from core.db import execute

# Tables that hold per-company data. Ordered by FK dependency — child
# tables first so cascades aren't strictly required. (CASCADE is set on
# most FKs, but explicit deletes are clearer + handle non-cascade rows.)
PER_COMPANY_TABLES = [
    "intelligence_insights",
    "job_cost_reconciliation",
    "schedule_allocations",
    "follow_ups",     # via bid → company; cleaned by bids cascade below
    "bid_state_history",  # via bid cascade
    "bids",
    "burden_components",  # via employee cascade
    "employees",
    "documents",
    "scope_patterns",
    "pricing_logic",
    "service_lines",
    "voice_patterns",
]


def wipe_company_data(company_id: str) -> None:
    """Delete all rows for the company except the companies row itself.

    The companies row stays put so re-seeds don't break FK references in
    code paths that might already hold the company id (e.g. test demo
    bookmarks). The companies row is upserted in each archetype's
    seed_company() with ON CONFLICT.
    """
    # follow_ups, bid_state_history, jcr, schedule_allocations all
    # cascade from bids. burden_components cascades from employees.
    # Explicit deletes here for safety + clarity.
    execute(
        """
        DELETE FROM intelligence_insights WHERE company_id = %s
        """,
        (company_id,),
    )
    execute(
        """
        DELETE FROM job_cost_reconciliation WHERE company_id = %s
        """,
        (company_id,),
    )
    execute(
        """
        DELETE FROM schedule_allocations WHERE company_id = %s
        """,
        (company_id,),
    )
    execute(
        """
        DELETE FROM follow_ups WHERE bid_id IN (
            SELECT id FROM bids WHERE company_id = %s
        )
        """,
        (company_id,),
    )
    execute(
        """
        DELETE FROM bid_state_history WHERE bid_id IN (
            SELECT id FROM bids WHERE company_id = %s
        )
        """,
        (company_id,),
    )
    execute("DELETE FROM bids WHERE company_id = %s", (company_id,))
    execute(
        """
        DELETE FROM burden_components WHERE employee_id IN (
            SELECT id FROM employees WHERE company_id = %s
        )
        """,
        (company_id,),
    )
    execute("DELETE FROM employees WHERE company_id = %s", (company_id,))
    execute("DELETE FROM documents WHERE company_id = %s", (company_id,))
    execute("DELETE FROM scope_patterns WHERE company_id = %s", (company_id,))
    execute("DELETE FROM pricing_logic WHERE company_id = %s", (company_id,))
    execute("DELETE FROM service_lines WHERE company_id = %s", (company_id,))
    execute("DELETE FROM voice_patterns WHERE company_id = %s", (company_id,))
