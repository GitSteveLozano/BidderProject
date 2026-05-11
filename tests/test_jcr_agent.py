"""Tests for the JCR agent's reconciliation + pattern detection paths.

These tests stub out the DB layer and labor-hours tool so we can drive
reconcile_job and detect_patterns deterministically.
"""
from __future__ import annotations

import pytest


@pytest.fixture
def jcr_db_stub(monkeypatch):
    """Per-test recording for JCR writes + supplying fake bid / payroll data."""
    state = {
        "bids": {
            "bid-x": {
                "id": "bid-x",
                "company_id": "company-1",
                "pricing_breakdown": {
                    "labor": {"total_hours": 400, "subtotal": 20000.0},
                    "materials": {"subtotal": 34200.0},
                    "overhead": {"subtotal": 11594.0},
                    "profit": {"subtotal": 19830.0, "target_margin_pct": 32.0},
                },
            }
        },
        "quoted_summary": {
            "quoted_total_price": 96000.0,
            "quoted_labor_hours": 400,
            "quoted_labor_cost": 20000.0,
            "quoted_material_cost": 34200.0,
        },
        "actual_hours": {
            "bid_id": "bid-x",
            "total_hours": 460,
            "total_labor_cost": 23000.0,
            "by_trade": {"stucco_journeyman": {"hours": 460, "cost": 23000.0}},
            "citation": "stub",
        },
        "executes": [],
        "reconcile_rows": {},
    }

    import core.db as core_db
    from tools import actual_hours_lookup

    def fetch_one(sql, params=None):
        sl = sql.lower()
        if "from bids where id" in sl and "company_id" in sl:
            return state["bids"].get(params[0])
        if "select pricing_breakdown" in sl:
            b = state["bids"].get(params[0])
            return {
                "pricing_breakdown": b["pricing_breakdown"],
                "estimated_labor_hours": 400,
                "estimated_value": 96000,
            } if b else None
        return None

    def fetch_all(sql, params=None):
        if "group by b.service_line" in sql.lower():
            return state.get("pattern_rows", [])
        return []

    def execute(sql, params=None):
        state["executes"].append((sql.split()[0].upper(), params))

    monkeypatch.setattr(core_db, "fetch_one", fetch_one)
    monkeypatch.setattr(core_db, "fetch_all", fetch_all)
    monkeypatch.setattr(core_db, "execute", execute)
    monkeypatch.setattr(
        actual_hours_lookup, "get_actual_labor_hours", lambda bid_id: state["actual_hours"]
    )
    monkeypatch.setattr(
        actual_hours_lookup, "get_quoted_labor_summary", lambda bid_id: state["quoted_summary"]
    )
    return state


class TestReconcileJob:
    def test_eifs_overrun_reduces_margin(self, jcr_db_stub):
        """The seeded EIFS pattern: 460 actual hours vs 400 quoted = +15%."""
        from agents import jcr

        # Need to patch the import inside jcr too — it imports from tools.actual_hours_lookup
        result = jcr.reconcile_job("bid-x", actual_material_cost=36100, actual_other_costs=0)

        assert result["actual_labor_hours"] == 460
        assert result["variance_labor_hours_pct"] == 15.0
        # Quoted 96k, actual 23k + 36.1k = 59.1k → margin 38.4%
        assert result["delivered_margin_pct"] > 30.0
        # An INSERT into job_cost_reconciliation was issued
        sql_kinds = [e[0] for e in jcr_db_stub["executes"]]
        assert "INSERT" in sql_kinds
        assert "UPDATE" in sql_kinds

    def test_bid_not_found_raises(self, jcr_db_stub):
        from agents import jcr

        jcr_db_stub["bids"] = {}  # empty
        with pytest.raises(ValueError, match="not found"):
            jcr.reconcile_job("missing-id")


class TestPatternDetection:
    def test_pattern_emerges_above_threshold(self, jcr_db_stub):
        """When average labor variance >= 5%, surface a pattern."""
        from agents import jcr

        jcr_db_stub["pattern_rows"] = [
            {
                "service_line": "EIFS",
                "n": 8,
                "avg_var_labor": 14.5,
                "avg_var_cost": 6.2,
                "avg_margin": 26.0,
                "avg_quote_value": 175000,
            }
        ]
        patterns = jcr.detect_patterns("company-1")
        assert len(patterns) == 1
        assert patterns[0]["service_line"] == "EIFS"
        assert patterns[0]["avg_labor_variance_pct"] == 14.5
        assert "EIFS" in patterns[0]["recommendation"]

    def test_below_threshold_no_pattern(self, jcr_db_stub):
        from agents import jcr

        jcr_db_stub["pattern_rows"] = [
            {
                "service_line": "STUCCO-CONVENTIONAL",
                "n": 10,
                "avg_var_labor": 1.5,  # below 5% noise floor
                "avg_var_cost": 0.8,
                "avg_margin": 32.0,
                "avg_quote_value": 36000,
            }
        ]
        patterns = jcr.detect_patterns("company-1")
        assert patterns == []
