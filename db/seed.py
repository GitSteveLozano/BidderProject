"""Seed Archetype A — 'Honolulu Stucco & Exteriors LLC' (Cavy-derived).

Run: python -m db.seed

Seeds spec §8 demo data:
- 1 company, repeat_customer segment
- 8 employees with burden_components (per §8.5 table)
- 5 service lines with standard_exclusions
- pricing_logic with margin range 25-40%, capacity_discount_behavior=flex_by_schedule
- voice_patterns + scope_patterns
- 12 weeks of schedule_allocations (utilization curve per §8.5)
- 40 historical bids with reconciliation across all service lines
- 5 seeded intelligence insights
"""
from __future__ import annotations

import json
import random
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from core.db import execute, fetch_one
from core.settings import get_settings

random.seed(42)

COMPANY_ID = get_settings().demo_company_id
SEED_DIR = Path(__file__).parent / "seed_data"


# ─── Employees + burden (spec §8.5 table) ──────────────────────
EMPLOYEES = [
    ("Lead Stucco Mech",  "lead_stucco_mech",  "5022", 46.00, 68.08, 0.480),
    ("Stucco Journ A",    "stucco_journeyman", "5022", 38.00, 55.86, 0.470),
    ("Stucco Journ B",    "stucco_journeyman", "5022", 38.00, 55.86, 0.470),
    ("EIFS Installer",    "eifs_installer",    "5022", 42.00, 61.74, 0.470),
    ("Sider Lead",        "siding_lead",       "5645", 36.00, 54.00, 0.500),
    ("Sider",             "siding_installer",  "5645", 30.00, 45.00, 0.500),
    ("Finisher",          "finisher",          "5022", 32.00, 46.72, 0.460),
    ("Helper",            "general_laborer",   "5606", 22.00, 31.46, 0.430),
]

# ─── Service lines (Cavy taxonomy from spec §8.1) ──────────────
SERVICE_LINES = [
    {
        "line_name": "STUCCO-CONVENTIONAL",
        "typical_scope_text": (
            "Three-coat conventional stucco system applied over metal lath and "
            "weather-resistive barrier. Includes scratch, brown, and finish coats "
            "to manufacturer specifications."
        ),
        "standard_exclusions": [
            "Rough grade should not be above final grade height",
            "Painting and waterproof coatings beyond integral color",
            "Caulking of dissimilar material joints (by GC or others)",
            "Sheet metal flashings, drip caps, and weep screeds (by others unless noted)",
            "Permits, fees, and engineering",
            "Final grading, landscaping, and irrigation",
            "Repair of damage caused by other trades",
        ],
        "pricing_unit": "per_sqft",
        "pricing_range_residential": {"low": 12, "mid": 16, "high": 22},
        "pricing_range_commercial": {"low": 14, "mid": 18, "high": 26},
        "typical_margin_pct": 32.0,
        "manufacturers_referenced": ["BMI Products", "ADEX", "Sto"],
    },
    {
        "line_name": "STUCCO-textured acrylic",
        "typical_scope_text": (
            "Acrylic textured finish coat over base coat. Specified texture per "
            "manufacturer's standard color and finish samples."
        ),
        "standard_exclusions": [
            "Color samples beyond standard color chart",
            "Tinting of base coat",
            "Painting and waterproof coatings",
            "Caulking of dissimilar material joints",
            "Permits, fees, and engineering",
        ],
        "pricing_unit": "per_sqft",
        "pricing_range_residential": {"low": 5, "mid": 7, "high": 10},
        "pricing_range_commercial": {"low": 6, "mid": 8, "high": 12},
        "typical_margin_pct": 35.0,
        "manufacturers_referenced": ["ADEX", "Sto", "Dryvit"],
    },
    {
        "line_name": "EIFS",
        "typical_scope_text": (
            "Exterior Insulation and Finish System (EIFS) per ADEX system "
            "specification. Includes adhesive, EPS insulation, base coat with "
            "reinforcing mesh, and acrylic finish coat."
        ),
        "standard_exclusions": [
            "Rough grade should not be above final grade height",
            "Substrate preparation beyond cleaning and minor patching",
            "Sealants between dissimilar materials (by others)",
            "Sheet metal flashings (by others)",
            "Painting beyond integral finish color",
            "Permits, engineering, and design",
            "Repair of damage from other trades or weather events",
        ],
        "pricing_unit": "per_sqft",
        "pricing_range_residential": {"low": 18, "mid": 24, "high": 32},
        "pricing_range_commercial": {"low": 22, "mid": 28, "high": 38},
        "typical_margin_pct": 30.0,
        "manufacturers_referenced": ["ADEX", "Sto", "Dryvit"],
    },
    {
        "line_name": "Siding",
        "typical_scope_text": (
            "Fiber cement or metal siding installation per manufacturer spec. "
            "Includes underlayment, trim, and fasteners per specification."
        ),
        "standard_exclusions": [
            "Painting (by others unless pre-finished product specified)",
            "Sheet metal flashings beyond manufacturer-supplied trim",
            "Caulking between siding and dissimilar materials",
            "Substrate repair beyond minor patching",
            "Permits and inspections",
            "Insulation and weather-resistive barrier (by others)",
        ],
        "pricing_unit": "per_sqft",
        "pricing_range_residential": {"low": 9, "mid": 13, "high": 18},
        "pricing_range_commercial": {"low": 11, "mid": 15, "high": 22},
        "typical_margin_pct": 28.0,
        "manufacturers_referenced": ["James Hardie", "Gentek", "LUX"],
    },
    {
        "line_name": "METAL WORK",
        "typical_scope_text": (
            "Metal cladding panels and trim with associated flashings. Per "
            "approved shop drawings and manufacturer specifications."
        ),
        "standard_exclusions": [
            "Engineering and stamped shop drawings beyond standard details",
            "Caulking between metal and dissimilar materials",
            "Substrate beyond steel studs / sheathing as provided",
            "Painting / coatings beyond factory finish",
            "Permits and inspections",
        ],
        "pricing_unit": "per_lf",
        "pricing_range_residential": {"low": 22, "mid": 38, "high": 60},
        "pricing_range_commercial": {"low": 28, "mid": 45, "high": 75},
        "typical_margin_pct": 34.0,
        "manufacturers_referenced": ["Gentek", "Vicwest", "ATAS"],
    },
    {
        "line_name": "RESTUCCO",
        "typical_scope_text": (
            "Re-stucco existing surfaces. Includes surface preparation, repair of "
            "cracks and spalling, and application of new finish coat."
        ),
        "standard_exclusions": [
            "Removal and replacement of existing stucco beyond noted areas",
            "Painting beyond integral color finish",
            "Structural repair of substrate",
            "Sheet metal flashings",
            "Permits and engineering",
        ],
        "pricing_unit": "per_sqft",
        "pricing_range_residential": {"low": 7, "mid": 10, "high": 14},
        "pricing_range_commercial": {"low": 8, "mid": 12, "high": 16},
        "typical_margin_pct": 36.0,
        "manufacturers_referenced": ["BMI Products", "ADEX"],
    },
    {
        "line_name": "REPAIR",
        "typical_scope_text": (
            "Patch and repair of stucco / EIFS / siding surfaces. Time-and-"
            "materials or lump-sum per scope. Color match where possible."
        ),
        "standard_exclusions": [
            "Exact color matching of weathered substrates",
            "Painting of repaired areas (by others)",
            "Underlying water damage repair beyond noted scope",
            "Permits",
        ],
        "pricing_unit": "lump_sum",
        "pricing_range_residential": {"low": 1500, "mid": 4500, "high": 12000},
        "pricing_range_commercial": {"low": 2500, "mid": 8000, "high": 25000},
        "typical_margin_pct": 38.0,
        "manufacturers_referenced": ["BMI Products"],
    },
    {
        "line_name": "DEMOLITION",
        "typical_scope_text": (
            "Selective demolition of existing wall systems for replacement. "
            "Includes removal, debris bin, and haul-away."
        ),
        "standard_exclusions": [
            "Hazardous material abatement (asbestos, lead — by others)",
            "Structural demolition or load-bearing element removal",
            "Disposal fees for hazardous materials",
            "Permits and notifications",
            "Cleaning of adjacent areas",
        ],
        "pricing_unit": "per_sqft",
        "pricing_range_residential": {"low": 3, "mid": 5, "high": 8},
        "pricing_range_commercial": {"low": 4, "mid": 6, "high": 10},
        "typical_margin_pct": 30.0,
        "manufacturers_referenced": [],
    },
]


# ─── Voice patterns (from Cavy's quote style) ──────────────────
VOICE = {
    "tone": "direct, professional, no-nonsense; reads like a foreman wrote it",
    "avg_sentence_length": 17,
    "preferred_terms": {
        "scope": ["scope of work", "work to be performed"],
        "exclusions": ["the following are excluded", "we exclude"],
        "client": ["owner", "general contractor"],
    },
    "avoided_terms": ["partner", "synergy", "deliverable", "leverage"],
    "boilerplate_intro": (
        "Thank you for the opportunity to provide a quote on this project. We "
        "are pleased to offer the following based on the scope and drawings "
        "supplied."
    ),
    "boilerplate_scope_intro": "Our scope of work consists of the following:",
    "boilerplate_terms": (
        "Pricing is valid for 30 days from the date of this quote. Net 30 from "
        "invoice unless otherwise agreed. Progress draws available on jobs "
        "exceeding 4 weeks."
    ),
    "boilerplate_warranty": (
        "All workmanship is warranted for one year from substantial completion. "
        "Material warranties pass through from manufacturer."
    ),
    "boilerplate_closing": (
        "Please call with any questions. We appreciate the opportunity and look "
        "forward to working with you."
    ),
    "formatting": {
        "uses_bullet_points": True,
        "section_headers": True,
        "all_caps_emphasis": False,
    },
}


def seed_company() -> str:
    execute(
        """
        INSERT INTO companies (id, name, primary_trade, segment, years_in_business,
                               size_band, annual_revenue_band, onboarded_at)
        VALUES (%s, %s, 'specialty_construction', 'repeat_customer', 16,
                '8-15 employees', '$2M-$5M', NOW())
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            segment = EXCLUDED.segment,
            onboarded_at = EXCLUDED.onboarded_at
        """,
        (COMPANY_ID, "Honolulu Stucco & Exteriors LLC"),
    )
    return COMPANY_ID


def seed_voice() -> None:
    execute(
        """
        INSERT INTO voice_patterns (
            company_id, tone, avg_sentence_length, preferred_terms, avoided_terms,
            boilerplate_intro, boilerplate_scope_intro, boilerplate_terms,
            boilerplate_warranty, boilerplate_closing, formatting
        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        ON CONFLICT (company_id) DO UPDATE SET
            tone = EXCLUDED.tone,
            avg_sentence_length = EXCLUDED.avg_sentence_length,
            preferred_terms = EXCLUDED.preferred_terms,
            avoided_terms = EXCLUDED.avoided_terms,
            boilerplate_intro = EXCLUDED.boilerplate_intro,
            boilerplate_scope_intro = EXCLUDED.boilerplate_scope_intro,
            boilerplate_terms = EXCLUDED.boilerplate_terms,
            boilerplate_warranty = EXCLUDED.boilerplate_warranty,
            boilerplate_closing = EXCLUDED.boilerplate_closing,
            formatting = EXCLUDED.formatting,
            last_extracted_at = NOW()
        """,
        (
            COMPANY_ID, VOICE["tone"], VOICE["avg_sentence_length"],
            json.dumps(VOICE["preferred_terms"]), VOICE["avoided_terms"],
            VOICE["boilerplate_intro"], VOICE["boilerplate_scope_intro"],
            VOICE["boilerplate_terms"], VOICE["boilerplate_warranty"],
            VOICE["boilerplate_closing"], json.dumps(VOICE["formatting"]),
        ),
    )


def seed_service_lines() -> None:
    for sl in SERVICE_LINES:
        execute(
            """
            INSERT INTO service_lines (
                company_id, line_name, typical_scope_text, standard_exclusions,
                pricing_unit, pricing_range_residential, pricing_range_commercial,
                typical_margin_pct, manufacturers_referenced
            ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (company_id, line_name) DO UPDATE SET
                typical_scope_text = EXCLUDED.typical_scope_text,
                standard_exclusions = EXCLUDED.standard_exclusions,
                pricing_unit = EXCLUDED.pricing_unit,
                pricing_range_residential = EXCLUDED.pricing_range_residential,
                pricing_range_commercial = EXCLUDED.pricing_range_commercial,
                typical_margin_pct = EXCLUDED.typical_margin_pct,
                manufacturers_referenced = EXCLUDED.manufacturers_referenced
            """,
            (
                COMPANY_ID, sl["line_name"], sl["typical_scope_text"],
                sl["standard_exclusions"], sl["pricing_unit"],
                json.dumps(sl["pricing_range_residential"]),
                json.dumps(sl["pricing_range_commercial"]),
                sl["typical_margin_pct"], sl["manufacturers_referenced"],
            ),
        )


def seed_pricing_logic() -> None:
    execute(
        """
        INSERT INTO pricing_logic (
            company_id, default_labor_markup_pct, default_material_markup_pct,
            overhead_pct, target_margin_pct, margin_range_low_pct,
            margin_range_high_pct, capacity_discount_behavior,
            minimum_bid_threshold, payment_terms_default, deposit_pct
        ) VALUES (%s, 1.65, 1.25, 18.0, 32.0, 25.0, 40.0,
                  'flex_by_schedule', 2500, 'Net 30', 0.0)
        ON CONFLICT (company_id) DO UPDATE SET
            target_margin_pct = EXCLUDED.target_margin_pct,
            margin_range_low_pct = EXCLUDED.margin_range_low_pct,
            margin_range_high_pct = EXCLUDED.margin_range_high_pct,
            capacity_discount_behavior = EXCLUDED.capacity_discount_behavior
        """,
        (COMPANY_ID,),
    )


def seed_scope_patterns() -> None:
    execute(
        """
        INSERT INTO scope_patterns (
            company_id, typical_inclusions, typical_assumptions,
            addenda_patterns, upgrade_patterns
        ) VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (company_id) DO UPDATE SET
            typical_inclusions = EXCLUDED.typical_inclusions,
            typical_assumptions = EXCLUDED.typical_assumptions,
            addenda_patterns = EXCLUDED.addenda_patterns,
            upgrade_patterns = EXCLUDED.upgrade_patterns
        """,
        (
            COMPANY_ID,
            [
                "All labor, supervision, equipment, and materials per scope",
                "One mobilization for the work as described",
                "Clean-up of our work area daily",
            ],
            [
                "Continuous site access during normal working hours",
                "Power and water provided by GC at no cost",
                "Adjacent trades sequenced to allow our work",
            ],
            [
                "Sheet metal flashings provided by others",
                "Sealants between dissimilar materials by others",
            ],
            ["$0.00 line items for optional upgrades"],
        ),
    )


def seed_employees() -> dict[str, str]:
    """Return mapping of trade_classification -> first employee id."""
    out: dict[str, str] = {}
    for name, trade, ncci, base, loaded, burden in EMPLOYEES:
        emp_id = str(uuid.uuid4())
        execute(
            """
            INSERT INTO employees (id, company_id, name, trade_classification,
                                   ncci_class_code, base_hourly_rate,
                                   ot_multiplier, hire_date, status)
            VALUES (%s, %s, %s, %s, %s, %s, 1.5, %s, 'active')
            """,
            (emp_id, COMPANY_ID, name, trade, ncci, base, date(2020, 1, 1)),
        )
        execute(
            """
            INSERT INTO burden_components (
                employee_id, effective_date, fica_pct, futa_pct, suta_pct,
                workers_comp_rate_per_100, experience_mod_factor,
                phca_health_monthly, tdi_employer_weekly, retirement_match_pct,
                pto_accrual_hours_yr, training_annual, other_benefits_monthly,
                total_burden_pct, loaded_hourly_rate
            ) VALUES (%s, %s, 0.0765, 0.006, 0.024,
                      9.80, 1.0,
                      820, 7.2, 0.03,
                      80, 450, 50,
                      %s, %s)
            """,
            (emp_id, date(2026, 1, 1), burden, loaded),
        )
        out.setdefault(trade, emp_id)
    return out


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def seed_schedule(employee_ids: dict[str, str]) -> None:
    """Per spec §8.5: weeks 28-32 with utilizations 78/84/84/62/41%.

    We map spec week numbers to today-relative offset so the demo works in
    any week.
    """
    today_monday = _monday(date.today())
    weeks = [
        (today_monday + timedelta(weeks=0), 0.78),
        (today_monday + timedelta(weeks=1), 0.84),
        (today_monday + timedelta(weeks=2), 0.84),
        (today_monday + timedelta(weeks=3), 0.62),
        (today_monday + timedelta(weeks=4), 0.41),
        (today_monday + timedelta(weeks=5), 0.55),
        (today_monday + timedelta(weeks=6), 0.45),
        (today_monday + timedelta(weeks=7), 0.30),
        (today_monday + timedelta(weeks=8), 0.20),
        (today_monday + timedelta(weeks=9), 0.10),
        (today_monday + timedelta(weeks=10), 0.05),
        (today_monday + timedelta(weeks=11), 0.05),
    ]
    headcount = len(EMPLOYEES)
    weekly_capacity_total = headcount * 40
    for wk_start, util in weeks:
        target_hours_total = int(weekly_capacity_total * util)
        # Distribute hours roughly evenly across employees
        per_employee = target_hours_total // headcount
        leftover = target_hours_total - per_employee * headcount
        emp_ids = list({e for e in employee_ids.values()})
        # Re-fetch all employees because employee_ids only has 1 per trade
        from core.db import fetch_all

        all_emps = fetch_all(
            "SELECT id, trade_classification FROM employees WHERE company_id = %s",
            (COMPANY_ID,),
        )
        for i, emp in enumerate(all_emps):
            hours = per_employee + (1 if i < leftover else 0)
            if hours <= 0:
                continue
            execute(
                """
                INSERT INTO schedule_allocations (
                    employee_id, bid_id, company_id, week_start_date,
                    allocated_hours, trade_role
                ) VALUES (%s, NULL, %s, %s, %s, %s)
                """,
                (emp["id"], COMPANY_ID, wk_start, hours, emp["trade_classification"]),
            )


def seed_prevailing_wages() -> None:
    rows = [
        ("stucco_journeyman", "Honolulu", 48.50, 14.20, 62.70, date(2025, 9, 1), "2025-09"),
        ("siding_installer",  "Honolulu", 44.10, 13.80, 57.90, date(2025, 9, 1), "2025-09"),
        ("general_laborer",   "Honolulu", 32.20, 11.50, 43.70, date(2025, 9, 1), "2025-09"),
    ]
    for r in rows:
        execute(
            """
            INSERT INTO prevailing_wages (trade, county, basic_hourly, fringe_hourly,
                                          total_hourly, effective_date, bulletin_number)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            """, r,
        )


# ─── Historical bids + reconciliations ─────────────────────────


def _generate_historical_bids() -> None:
    """Create 40 historical bids with realistic outcomes + reconciliations.

    Drawn from Cavy's pricing range ($2.5K - $1.18M, median ~$36K). Margin
    targets ±variance per service-line spec. EIFS deliberately runs hot
    (12-18% over) so the Intelligence agent has a real pattern to detect.
    """
    from core.db import fetch_all

    emps = fetch_all(
        "SELECT id, trade_classification FROM employees WHERE company_id = %s",
        (COMPANY_ID,),
    )
    by_trade: dict[str, list[str]] = {}
    for e in emps:
        by_trade.setdefault(e["trade_classification"], []).append(e["id"])

    # Distribution of jobs across service lines (Cavy-like)
    plan = [
        ("STUCCO-CONVENTIONAL", 11, (15000, 95000), 0.32, 0.04),
        ("EIFS",                10, (35000, 240000), 0.27, 0.05),  # runs hot
        ("Siding",               8, (8000, 80000), 0.28, 0.04),
        ("STUCCO-textured acrylic", 4, (4000, 28000), 0.36, 0.03),
        ("RESTUCCO",             4, (3500, 22000), 0.34, 0.04),
        ("REPAIR",               3, (2500, 15000), 0.38, 0.05),
    ]
    competitors_by_line = {
        "EIFS":   ["Inex Plastering", "Metro Plastering", "Eco Exteriors"],
        "Siding": ["Red River Siding", "Eco Exteriors"],
        "STUCCO-CONVENTIONAL": ["Metro Plastering", "Dels Exteriors"],
    }

    base_day = date.today() - timedelta(days=540)
    bid_idx = 0
    for service_line, n_jobs, (low, high), target_margin, var_sigma in plan:
        for _ in range(n_jobs):
            bid_id = str(uuid.uuid4())
            quoted_value = round(random.uniform(low, high), 2)
            quoted_hours = max(20, int(quoted_value / random.uniform(150, 250)))
            quoted_labor_cost = round(quoted_hours * random.uniform(45, 65), 2)
            quoted_material_cost = round(quoted_value * random.uniform(0.30, 0.45), 2)

            client_name = f"Client #{1000+bid_idx}"
            created = base_day + timedelta(days=bid_idx * 12)
            start = created + timedelta(days=21)

            outcome = random.choices(
                ["WON", "LOST", "STALLED", "NO_DECISION"],
                weights=[0.65, 0.20, 0.10, 0.05],
            )[0]
            state_path = []
            if outcome == "WON":
                state = "RECONCILED"
                state_path = [
                    "RFP_RECEIVED", "ASSESSING", "DRAFT_GENERATED",
                    "HUMAN_REVIEW", "SENT", "WON", "JOB_IN_PROGRESS",
                    "JOB_COMPLETE", "RECONCILED",
                ]
            elif outcome == "LOST":
                state = "LOST"
                state_path = ["RFP_RECEIVED", "ASSESSING", "DRAFT_GENERATED",
                              "HUMAN_REVIEW", "SENT", "LOST"]
            elif outcome == "STALLED":
                state = "STALLED"
                state_path = ["RFP_RECEIVED", "ASSESSING", "DRAFT_GENERATED",
                              "HUMAN_REVIEW", "SENT", "STALLED"]
            else:
                state = "NO_DECISION"
                state_path = ["RFP_RECEIVED", "ASSESSING", "DRAFT_GENERATED",
                              "HUMAN_REVIEW", "SENT", "NO_DECISION"]

            competitor = (
                random.choice(competitors_by_line.get(service_line, ["Other"]))
                if outcome == "LOST" else None
            )
            winning_bid = (
                round(quoted_value * random.uniform(0.88, 0.97), 2)
                if outcome == "LOST" else None
            )

            pricing_breakdown = {
                "service_line": service_line,
                "labor": {"total_hours": quoted_hours, "subtotal": quoted_labor_cost},
                "materials": {"subtotal": quoted_material_cost},
                "overhead": {"subtotal": round(quoted_value * 0.18, 2)},
                "profit": {"subtotal": round(quoted_value * target_margin, 2),
                           "target_margin_pct": target_margin * 100},
                "target_price": quoted_value,
                "range_low": round(quoted_value * 0.92, 2),
                "range_high": round(quoted_value * 1.10, 2),
                "capacity_utilization_at_start": random.uniform(0.4, 0.95),
            }

            execute(
                """
                INSERT INTO bids (
                    id, company_id, state, service_line, client_name, client_segment,
                    scope_summary, estimated_value, estimated_labor_hours,
                    estimated_start_date, pricing_breakdown,
                    created_at, draft_generated_at, sent_at,
                    outcome, outcome_reason, outcome_competitor,
                    outcome_winning_bid, outcome_captured_at,
                    exclusions_applied
                ) VALUES (%s,%s,%s,%s,%s,'repeat',
                          %s,%s,%s,%s,%s,
                          %s,%s,%s,
                          %s,%s,%s,
                          %s,%s,
                          %s)
                """,
                (
                    bid_id, COMPANY_ID, state, service_line, client_name,
                    f"{service_line} on {client_name} property",
                    quoted_value, quoted_hours, start, json.dumps(pricing_breakdown),
                    datetime.combine(created, datetime.min.time()),
                    datetime.combine(created + timedelta(days=1), datetime.min.time()),
                    datetime.combine(created + timedelta(days=2), datetime.min.time()),
                    outcome,
                    "lost on price" if outcome == "LOST" else None,
                    competitor,
                    winning_bid,
                    datetime.combine(created + timedelta(days=14), datetime.min.time())
                    if outcome != "WON" else None,
                    next(
                        (sl["standard_exclusions"][:3] for sl in SERVICE_LINES
                         if sl["line_name"] == service_line), []
                    ),
                ),
            )

            for i, st_name in enumerate(state_path):
                execute(
                    """
                    INSERT INTO bid_state_history (bid_id, from_state, to_state,
                                                   triggered_by, occurred_at)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (
                        bid_id,
                        state_path[i-1] if i > 0 else None,
                        st_name,
                        "seed",
                        datetime.combine(created + timedelta(days=i*7), datetime.min.time()),
                    ),
                )

            # Reconciliation for WON jobs only
            if outcome == "WON":
                # EIFS deliberately runs hot for pattern detection
                if service_line == "EIFS":
                    labor_var = random.uniform(0.10, 0.18)
                else:
                    labor_var = random.gauss(0.0, var_sigma)
                actual_hours = max(1, int(quoted_hours * (1 + labor_var)))
                # Sample 4 employees per job
                sampled = random.sample(emps, k=min(4, len(emps)))
                hours_each = max(4, actual_hours // len(sampled))
                for e in sampled:
                    execute(
                        """
                        INSERT INTO schedule_allocations (
                            employee_id, bid_id, company_id, week_start_date,
                            allocated_hours, trade_role
                        ) VALUES (%s,%s,%s,%s,%s,%s)
                        """,
                        (e["id"], bid_id, COMPANY_ID,
                         start - timedelta(days=start.weekday()),
                         hours_each, e["trade_classification"]),
                    )
                avg_loaded = 52.0
                actual_labor_cost = round(actual_hours * avg_loaded, 2)
                actual_material_cost = round(
                    quoted_material_cost * random.uniform(0.95, 1.06), 2)
                actual_total = actual_labor_cost + actual_material_cost
                delivered_margin = round((quoted_value - actual_total) / quoted_value * 100, 2)
                var_labor_pct = round(labor_var * 100, 2)
                var_total_pct = round((actual_total - quoted_value) / quoted_value * 100, 2)
                execute(
                    """
                    INSERT INTO job_cost_reconciliation (
                        bid_id, company_id, quoted_price, quoted_labor_hours,
                        quoted_labor_cost, quoted_material_cost, quoted_margin_pct,
                        actual_labor_hours, actual_labor_cost, actual_material_cost,
                        actual_other_costs, delivered_margin_pct,
                        variance_labor_hours_pct, variance_total_cost_pct,
                        reconciled_at
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,
                              %s,%s,%s,%s,%s,%s,%s,%s)
                    """,
                    (
                        bid_id, COMPANY_ID, quoted_value, quoted_hours,
                        quoted_labor_cost, quoted_material_cost, target_margin*100,
                        actual_hours, actual_labor_cost, actual_material_cost, 0,
                        delivered_margin, var_labor_pct, var_total_pct,
                        datetime.combine(start + timedelta(days=45),
                                         datetime.min.time()),
                    ),
                )
                execute(
                    """
                    UPDATE bids SET
                        actual_labor_hours = %s,
                        actual_cost_total = %s,
                        delivered_margin_pct = %s
                    WHERE id = %s
                    """,
                    (actual_hours, actual_total, delivered_margin, bid_id),
                )

            bid_idx += 1


# ─── Pre-baked intelligence insights ─────────────────────────


def seed_initial_insights() -> None:
    insights = [
        (
            "capacity", "high",
            "Hold firm on top open EIFS quote — schedule is 82% full",
            "Average utilization across the next 4 weeks is 82%. The highest-"
            "value open quote is the EIFS package; discounting to win is not "
            "necessary based on current schedule.",
            "Hold target price on top open quote.",
            "~$8,200 retained margin vs typical 5% schedule-discount",
        ),
        (
            "margin", "medium",
            "EIFS delivered margin trending down 6pp vs target over last 8 jobs",
            "Average delivered margin on EIFS jobs is 26.4% vs target 32%. "
            "3 of last 4 EIFS jobs ran labor hours 12-18% over quote. ADEX-"
            "system install productivity assumption appears to need recalibration.",
            "Add +12% labor hour buffer on next 3 EIFS quotes; measure outcomes.",
            "Recover ~$4,800 margin per $100K EIFS revenue if formula updated",
        ),
        (
            "exclusions", "medium",
            "2 of 8 recent stucco-conventional quotes missed rough-grade exclusion",
            "Both of those jobs incurred scope creep (+18% and +22% labor). "
            "Composition agent's exclusions enforcement should auto-flag this "
            "exclusion on every stucco-conventional quote.",
            "Enable enforcement of 'Rough grade should not be above final "
            "grade height' for STUCCO-CONVENTIONAL service line.",
            "Prevents 18-22% labor overruns on affected jobs",
        ),
        (
            "competitor", "low",
            "Inex Plastering won 3 of last 5 EIFS bids you lost",
            "Average winning bid in those losses was 9.4% below your quote. "
            "Pattern: Inex appears willing to price aggressively on EIFS.",
            "When EIFS schedule utilization is <60%, consider matching Inex "
            "by 5-7% on shortlisted EIFS bids; otherwise hold.",
            "1-2 additional EIFS wins per quarter in low-utilization windows",
        ),
        (
            "follow_up", "info",
            "Repeat-customer single-touch follow-up has 73% response rate",
            "Of 22 SENT bids to repeat clients in the last 6 months, the "
            "5-day soft follow-up surfaced a decision in 16 cases (73%).",
            "Continue the single-touch repeat cadence; do not escalate.",
            "Avoids relationship damage; cadence is working",
        ),
    ]
    for ins in insights:
        execute(
            """
            INSERT INTO intelligence_insights (
                company_id, category, severity, headline, finding,
                recommendation, projected_impact, status
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, 'open')
            """,
            (COMPANY_ID, *ins),
        )


# ─── Past-quote document corpus (placeholder text) ─────────────


def seed_past_quote_documents() -> None:
    """Create document rows with synthesized past-quote text.

    Real Cavy corpus would be placed in data/raw/ and ingested by the
    Intake agent. This seed creates structured placeholders so the Context
    agent has something to work with even without the real PDFs.
    """
    for i in range(8):
        text = (
            f"{VOICE['boilerplate_intro']}\n\n"
            f"Project: Sample stucco job #{i+1}, Honolulu HI\n\n"
            f"{VOICE['boilerplate_scope_intro']}\n\n"
            f"- Three-coat conventional stucco system on metal lath\n"
            f"- Approximately 2,400 sqft of wall surface\n"
            f"- Integral-color finish coat per owner sample\n\n"
            f"The following are excluded:\n"
            f"- Rough grade should not be above final grade height\n"
            f"- Painting and waterproof coatings beyond integral color\n"
            f"- Caulking of dissimilar material joints (by GC or others)\n"
            f"- Sheet metal flashings, drip caps, and weep screeds\n"
            f"- Permits, fees, and engineering\n\n"
            f"Total: $36,400 (lump sum)\n\n"
            f"{VOICE['boilerplate_terms']}\n\n"
            f"{VOICE['boilerplate_warranty']}\n\n"
            f"{VOICE['boilerplate_closing']}\n"
        )
        execute(
            """
            INSERT INTO documents (company_id, type, filename, raw_text)
            VALUES (%s, 'past_quote', %s, %s)
            """,
            (COMPANY_ID, f"past_quote_{i+1}.txt", text),
        )


# ─── Main ───────────────────────────────────────────────────


def run() -> None:
    from db.seed_utils import wipe_company_data

    print(f"Wiping prior data for company {COMPANY_ID}...")
    wipe_company_data(COMPANY_ID)
    print(f"Seeding company {COMPANY_ID}...")
    seed_company()
    seed_voice()
    seed_service_lines()
    seed_pricing_logic()
    seed_scope_patterns()
    seed_past_quote_documents()
    emp_map = seed_employees()
    seed_schedule(emp_map)
    seed_prevailing_wages()
    print("Generating 40 historical bids with reconciliations...")
    _generate_historical_bids()
    print("Seeding 5 starter intelligence insights...")
    seed_initial_insights()
    n_bids = fetch_one(
        "SELECT COUNT(*) AS n FROM bids WHERE company_id = %s", (COMPANY_ID,)
    )["n"]
    n_recon = fetch_one(
        "SELECT COUNT(*) AS n FROM job_cost_reconciliation WHERE company_id = %s",
        (COMPANY_ID,),
    )["n"]
    print(f"Done. Bids: {n_bids}, reconciled: {n_recon}")


if __name__ == "__main__":
    run()
