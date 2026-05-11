"""Archetype C — Honolulu Marketing Agency (Tiny Bison-like) — spec §8.3.

Tertiary archetype. Demonstrates cross-vertical architecture range:
narrative proposal vs. itemized quote, different document type, different
pricing model (project + retainer hybrid), no payroll integration value
(no field hours per project) but voice + scope generation still apply.

Seeded thin — the demo shows ~60s walkthrough that the same orchestrator
produces structurally different output, not a full lifecycle.
"""
from __future__ import annotations

import json
import uuid
from datetime import date

from core.db import execute

COMPANY_ID = "00000000-0000-0000-0000-000000000003"

VOICE = {
    "tone": "warm, story-first, plain-language; reads like a strategist wrote it",
    "avg_sentence_length": 19,
    "preferred_terms": {
        "scope": ["work", "engagement"],
        "exclusions": ["what's not included"],
        "client": ["client", "team"],
    },
    "avoided_terms": ["leverage", "synergy", "deliverable", "stakeholder", "robust"],
    "boilerplate_intro": (
        "Thanks for the conversation last week — really enjoyed digging into "
        "what you're trying to build. Here's how we'd approach the work."
    ),
    "boilerplate_scope_intro": "Here's what we'd do for you:",
    "boilerplate_terms": (
        "Engagement starts on signed agreement and 50% deposit. Balance "
        "due on project completion. Two rounds of revision per phase "
        "included; additional rounds billed at $185/hr."
    ),
    "boilerplate_warranty": "",
    "boilerplate_closing": (
        "We'd love to work on this with you. Reply when you're ready and "
        "we'll send over the agreement."
    ),
    "formatting": {
        "uses_bullet_points": True,
        "section_headers": True,
        "all_caps_emphasis": False,
        "uses_narrative_paragraphs": True,
    },
}


SERVICE_LINES = [
    {
        "line_name": "BRAND-IDENTITY",
        "typical_scope_text": (
            "Brand identity engagement covering positioning, naming (if "
            "needed), logo system, visual language, and brand guidelines."
        ),
        "standard_exclusions": [
            "Trademark registration — handled by your legal counsel",
            "Custom photography — quoted separately if needed",
            "Web design and development",
            "Print production and merchandising",
        ],
        "pricing_unit": "project",
        "pricing_range_residential": None,
        "pricing_range_commercial": {"low": 28000, "mid": 55000, "high": 120000},
        "typical_margin_pct": 55.0,
        "manufacturers_referenced": [],
    },
    {
        "line_name": "WEBSITE-PROJECT",
        "typical_scope_text": (
            "Website strategy, design, and build. CMS-based (Webflow or "
            "WordPress) or static (Next.js) per requirements."
        ),
        "standard_exclusions": [
            "Hosting and ongoing maintenance — separate retainer if desired",
            "Ongoing content production beyond initial launch content",
            "Custom CMS development beyond agreed scope",
            "E-commerce setup unless explicitly included",
        ],
        "pricing_unit": "project",
        "pricing_range_residential": None,
        "pricing_range_commercial": {"low": 18000, "mid": 42000, "high": 95000},
        "typical_margin_pct": 50.0,
        "manufacturers_referenced": ["Webflow", "WordPress", "Next.js"],
    },
    {
        "line_name": "ONGOING-RETAINER",
        "typical_scope_text": (
            "Monthly retainer for ongoing brand and marketing support. "
            "Hours allocated; specific work scoped each month."
        ),
        "standard_exclusions": [
            "Paid media spend (ad budget separate)",
            "Production costs beyond strategy and creative",
            "Hours beyond retainer billed at $185/hr",
        ],
        "pricing_unit": "monthly",
        "pricing_range_residential": None,
        "pricing_range_commercial": {"low": 6500, "mid": 12000, "high": 22000},
        "typical_margin_pct": 60.0,
        "manufacturers_referenced": [],
    },
]


def run() -> None:
    print(f"Seeding Archetype C (Marketing Agency) company {COMPANY_ID}...")
    execute(
        """
        INSERT INTO companies (id, name, primary_trade, segment, years_in_business,
                               size_band, annual_revenue_band, onboarded_at)
        VALUES (%s, 'Honolulu Brand Co.', 'marketing_agency', 'mixed', 9,
                '4-7 employees', '$1M-$2M', NOW())
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            onboarded_at = EXCLUDED.onboarded_at
        """,
        (COMPANY_ID,),
    )
    execute(
        """
        INSERT INTO voice_patterns (
            company_id, tone, avg_sentence_length, preferred_terms, avoided_terms,
            boilerplate_intro, boilerplate_scope_intro, boilerplate_terms,
            boilerplate_warranty, boilerplate_closing, formatting
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (company_id) DO UPDATE SET
            tone = EXCLUDED.tone
        """,
        (
            COMPANY_ID, VOICE["tone"], VOICE["avg_sentence_length"],
            json.dumps(VOICE["preferred_terms"]), VOICE["avoided_terms"],
            VOICE["boilerplate_intro"], VOICE["boilerplate_scope_intro"],
            VOICE["boilerplate_terms"], VOICE["boilerplate_warranty"],
            VOICE["boilerplate_closing"], json.dumps(VOICE["formatting"]),
        ),
    )
    for sl in SERVICE_LINES:
        execute(
            """
            INSERT INTO service_lines (
                company_id, line_name, typical_scope_text, standard_exclusions,
                pricing_unit, pricing_range_commercial,
                typical_margin_pct, manufacturers_referenced
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (company_id, line_name) DO UPDATE SET
                typical_scope_text = EXCLUDED.typical_scope_text
            """,
            (
                COMPANY_ID, sl["line_name"], sl["typical_scope_text"],
                sl["standard_exclusions"],
                sl["pricing_unit"],
                json.dumps(sl["pricing_range_commercial"]) if sl.get("pricing_range_commercial") else None,
                sl["typical_margin_pct"],
                sl["manufacturers_referenced"],
            ),
        )
    execute(
        """
        INSERT INTO pricing_logic (
            company_id, overhead_pct, target_margin_pct,
            margin_range_low_pct, margin_range_high_pct,
            capacity_discount_behavior, deposit_pct
        ) VALUES (%s, 25.0, 55.0, 45.0, 65.0, 'fixed', 0.50)
        ON CONFLICT (company_id) DO UPDATE SET target_margin_pct = EXCLUDED.target_margin_pct
        """,
        (COMPANY_ID,),
    )
    print("Done.")


if __name__ == "__main__":
    run()
