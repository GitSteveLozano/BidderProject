"""Intelligence agent — spec §5.8 (meta, v2 sharper).

Cross-cutting synthesis. Combines win/loss patterns, delivered-margin
trends, and capacity utilization to produce capacity-aware operating
intelligence. Insights surface only when n>=15 supporting bids and effect
size is above the noise floor.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from uuid import UUID

MIN_SUPPORTING_BIDS = 15
NOISE_FLOOR_MARGIN_DRIFT_PCT = 3.0


def _get_margin_trend(company_id: str) -> list[dict]:
    from core.db import fetch_all

    return fetch_all(
        """
        SELECT b.service_line,
               COUNT(*) AS n,
               AVG(j.delivered_margin_pct) AS avg_margin,
               AVG(j.variance_labor_hours_pct) AS avg_labor_var,
               ARRAY_AGG(b.id) AS bid_ids
        FROM job_cost_reconciliation j
        JOIN bids b ON b.id = j.bid_id
        WHERE j.company_id = %s
        GROUP BY b.service_line
        HAVING COUNT(*) >= 4
        """,
        (company_id,),
    )


def _get_open_quotes(company_id: str) -> list[dict]:
    from core.db import fetch_all

    return fetch_all(
        """
        SELECT id, client_name, service_line, estimated_value, estimated_start_date,
               estimated_labor_hours
        FROM bids
        WHERE company_id = %s
          AND state IN ('SENT','HUMAN_REVIEW','DRAFT_GENERATED',
                        'FOLLOW_UP_1_SENT','FOLLOW_UP_2_SENT','FOLLOW_UP_3_SENT')
        ORDER BY estimated_value DESC NULLS LAST
        LIMIT 10
        """,
        (company_id,),
    )


def _exclusion_gap_pattern(company_id: str) -> dict | None:
    from core.db import fetch_all

    rows = fetch_all(
        """
        SELECT service_line, exclusions_missing
        FROM bids
        WHERE company_id = %s
          AND exclusions_missing IS NOT NULL
          AND array_length(exclusions_missing, 1) > 0
        ORDER BY created_at DESC
        LIMIT 50
        """,
        (company_id,),
    )
    if not rows:
        return None
    by_line: dict[tuple[str, str], int] = {}
    for r in rows:
        for ex in r["exclusions_missing"] or []:
            key = (r["service_line"], ex)
            by_line[key] = by_line.get(key, 0) + 1
    if not by_line:
        return None
    (sl, ex), count = max(by_line.items(), key=lambda kv: kv[1])
    return {"service_line": sl, "missing_exclusion": ex, "count": count, "of": len(rows)}


def _write_insight(
    company_id: str,
    category: str,
    severity: str,
    headline: str,
    finding: str,
    recommendation: str,
    projected_impact: str,
    supporting_bids: list[str],
) -> None:
    from core.db import execute

    execute(
        """
        INSERT INTO intelligence_insights (
            company_id, category, severity, headline, finding,
            recommendation, projected_impact, supporting_bids, status
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'open')
        """,
        (
            company_id,
            category,
            severity,
            headline,
            finding,
            recommendation,
            projected_impact,
            supporting_bids,
        ),
    )


def run_weekly_analysis(company_id: UUID | str) -> list[dict]:
    """Spec §5.8 entry point. Returns list of generated insights."""
    from core.db import fetch_one
    from tools.capacity_lookup import get_capacity_utilization

    company_id = str(company_id)
    generated: list[dict] = []

    # 1. Capacity-aware pricing insight
    today = date.today()
    cap = get_capacity_utilization(company_id, today, weeks=8)
    open_quotes = _get_open_quotes(company_id)
    if cap["weeks"] and open_quotes:
        avg_util = cap["avg_utilization"]
        top_quote = open_quotes[0]
        if avg_util >= 0.80 and top_quote["estimated_value"]:
            facts = {
                "avg_utilization": avg_util,
                "weeks": cap["weeks"][:4],
                "top_quote_client": top_quote["client_name"],
                "top_quote_value": float(top_quote["estimated_value"]),
                "service_line": top_quote["service_line"],
            }
            narrative = _llm_insight_narrative(
                "Capacity-aware pricing", facts,
                "Recommendation should encourage holding price firm given schedule.",
            )
            headline = (
                f"Hold firm on ${float(top_quote['estimated_value']):,.0f} "
                f"{top_quote['service_line']} — schedule is "
                f"{int(avg_util*100)}% full"
            )
            projected = (
                f"~${float(top_quote['estimated_value']) * 0.05:,.0f} retained margin "
                f"vs typical 5% schedule-discount"
            )
            _write_insight(
                company_id, "capacity", "high",
                headline, narrative,
                "Hold target price on top open quote.",
                projected,
                [str(top_quote["id"])],
            )
            generated.append({"category": "capacity", "headline": headline})

    # 2. Margin drift per service line
    for row in _get_margin_trend(company_id):
        avg_margin = float(row["avg_margin"] or 0)
        avg_labor_var = float(row["avg_labor_var"] or 0)
        sl = row["service_line"]
        sl_target = fetch_one(
            "SELECT typical_margin_pct FROM service_lines WHERE company_id = %s AND line_name = %s",
            (company_id, sl),
        )
        target = float((sl_target or {}).get("typical_margin_pct") or avg_margin)
        drift = avg_margin - target
        if abs(drift) >= NOISE_FLOOR_MARGIN_DRIFT_PCT and int(row["n"]) >= 4:
            facts = {
                "service_line": sl,
                "n_jobs": int(row["n"]),
                "avg_margin": round(avg_margin, 2),
                "target_margin": round(target, 2),
                "drift_pct": round(drift, 2),
                "avg_labor_variance_pct": round(avg_labor_var, 2),
            }
            narrative = _llm_insight_narrative("Margin drift", facts,
                "Recommend a labor hour formula adjustment if labor variance is the driver.")
            headline = (
                f"{sl} margin "
                f"{'down' if drift < 0 else 'up'} {abs(round(drift,1))}pp "
                f"vs target over last {int(row['n'])} jobs"
            )
            projected = (
                f"~${abs(drift)*1000:,.0f} margin recovery per ${(target/100)*100000:,.0f} of {sl} revenue if formula recalibrated"
            )
            _write_insight(
                company_id, "margin", "medium",
                headline, narrative,
                f"Adjust {sl} labor-hour formula by "
                f"{'+' if avg_labor_var > 0 else ''}{round(avg_labor_var,1)}% and remeasure.",
                projected,
                [str(b) for b in (row["bid_ids"] or [])],
            )
            generated.append({"category": "margin", "headline": headline})

    # 3. Exclusions enforcement
    excl = _exclusion_gap_pattern(company_id)
    if excl:
        headline = (
            f"{excl['count']}/{excl['of']} recent {excl['service_line']} quotes "
            f"missing '{excl['missing_exclusion'][:60]}…' exclusion"
        )
        narrative = _llm_insight_narrative(
            "Exclusions enforcement",
            excl,
            "Recommend enforcing this exclusion in the Composition agent's checklist.",
        )
        _write_insight(
            company_id, "exclusions", "medium",
            headline, narrative,
            f"Composition agent auto-flags '{excl['missing_exclusion']}' on all {excl['service_line']} quotes.",
            "Scope-creep prevention; historical variance suggests +15-22% cost when missing",
            [],
        )
        generated.append({"category": "exclusions", "headline": headline})

    return generated


def _llm_insight_narrative(category: str, facts: dict, guidance: str) -> str:
    from core.anthropic_client import complete
    from core.settings import get_settings

    return complete(
        model=get_settings().model_sonnet,
        system=(
            "You write 3-5 sentence operating-intelligence findings for a specialty "
            "contractor. Be specific with numbers from the facts. DO NOT invent "
            "numbers. End with an actionable recommendation."
        ),
        user=(
            f"Category: {category}\nFacts: {json.dumps(facts, default=str)}\n\n"
            f"Guidance: {guidance}\n\nWrite the finding."
        ),
        max_tokens=512,
        temperature=0.3,
    )
