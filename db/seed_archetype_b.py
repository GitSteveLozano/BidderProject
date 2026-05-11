"""Archetype B — Vantage Millwork (Dale Sandwith) — spec §8.2.

Cross-vertical validation. Different business shape from Cavy:
- Line-item driven, per-linear-foot pricing
- Catalog-driven scope (cabinets, doors, panels by SKU)
- Different exclusions templates focused on millwork pain points
- Smaller per-quote average but higher quote volume

The point of this archetype is to demonstrate that the contextual layer
adapts to a different business shape WITHOUT architectural changes. Same
8 agents, same 5 layers, completely different output.
"""
from __future__ import annotations

import json
import random
import uuid
from datetime import date, datetime, timedelta

from core.db import execute, fetch_one

random.seed(101)

COMPANY_ID = "00000000-0000-0000-0000-000000000002"

VOICE = {
    "tone": "precise, technical, catalog-oriented; reads like a shop foreman wrote it",
    "avg_sentence_length": 14,
    "preferred_terms": {
        "scope": ["work to be performed", "items quoted"],
        "exclusions": ["not included in this quote"],
        "client": ["builder", "owner"],
    },
    "avoided_terms": ["partnership", "ecosystem", "stakeholder"],
    "boilerplate_intro": (
        "Thank you for the opportunity. Please find our quote below for the "
        "millwork items as described in your request."
    ),
    "boilerplate_scope_intro": "Items quoted:",
    "boilerplate_terms": (
        "Quote valid 30 days. 50% deposit on order, balance net 30 from "
        "delivery. Custom items non-refundable once production starts."
    ),
    "boilerplate_warranty": (
        "Millwork warranted against manufacturer defect for one year from "
        "delivery. Field damage and finish wear are not covered."
    ),
    "boilerplate_closing": (
        "Please review and confirm. We'll begin production upon receipt of "
        "signed approval and deposit."
    ),
    "formatting": {
        "uses_bullet_points": False,
        "section_headers": True,
        "all_caps_emphasis": True,
        "uses_line_item_table": True,
    },
}


SERVICE_LINES = [
    {
        "line_name": "INTERIOR-DOORS",
        "typical_scope_text": (
            "Pre-hung interior door assemblies with jamb, casing, and stop. "
            "Standard core (hollow or solid as specified). Pre-finished."
        ),
        "standard_exclusions": [
            "Hardware (knobs, hinges, latches) — by others unless noted",
            "Field installation — supply only unless install line added",
            "Door bottoms / weatherstripping",
            "Custom finishes beyond standard catalog options",
            "Painting at job site",
        ],
        "pricing_unit": "per_unit",
        "pricing_range_residential": {"low": 220, "mid": 380, "high": 720},
        "pricing_range_commercial": {"low": 350, "mid": 550, "high": 1200},
        "typical_margin_pct": 28.0,
        "manufacturers_referenced": ["Masonite", "JELD-WEN", "Trustile"],
    },
    {
        "line_name": "CUSTOM-CABINETRY",
        "typical_scope_text": (
            "Shop-built custom cabinets per drawings supplied. Standard "
            "construction unless noted: 3/4 ply box, 5-piece raised panel "
            "door, soft-close hardware."
        ),
        "standard_exclusions": [
            "Counter tops — by others",
            "Field measurements — based on drawings supplied",
            "Plumbing, electrical, and appliance cutouts — by installer",
            "Field installation — supply only unless install line added",
            "Stone, tile, or backsplash work",
            "Hardware beyond Blum soft-close hinges and drawer slides",
        ],
        "pricing_unit": "per_lf",
        "pricing_range_residential": {"low": 220, "mid": 380, "high": 580},
        "pricing_range_commercial": {"low": 280, "mid": 480, "high": 850},
        "typical_margin_pct": 32.0,
        "manufacturers_referenced": ["Blum", "Hafele", "Wilsonart"],
    },
    {
        "line_name": "ARCHITECTURAL-PANELS",
        "typical_scope_text": (
            "Wall panel systems, custom millwork ceiling features, and "
            "feature-wall assemblies. CNC and shop-finished per drawings."
        ),
        "standard_exclusions": [
            "Field installation — supply only unless install line added",
            "Substrate / blocking — by GC",
            "Lighting integration beyond pre-routed channels",
            "Custom finishes beyond standard catalog options",
            "Acoustic backing materials",
        ],
        "pricing_unit": "per_sqft",
        "pricing_range_residential": {"low": 42, "mid": 68, "high": 110},
        "pricing_range_commercial": {"low": 52, "mid": 85, "high": 145},
        "typical_margin_pct": 38.0,
        "manufacturers_referenced": ["9Wood", "Decoustics", "Hunter Douglas"],
    },
    {
        "line_name": "BASE-CASING",
        "typical_scope_text": (
            "Base, casing, and chair rail trim packages. Pre-primed MDF or "
            "solid wood per spec. Standard profiles from catalog."
        ),
        "standard_exclusions": [
            "Field installation — supply only unless install line added",
            "Custom profiles beyond catalog",
            "Stain / paint finishing at job site",
            "Caulking and putty filling",
        ],
        "pricing_unit": "per_lf",
        "pricing_range_residential": {"low": 2.8, "mid": 4.5, "high": 7.5},
        "pricing_range_commercial": {"low": 3.5, "mid": 5.5, "high": 9.0},
        "typical_margin_pct": 25.0,
        "manufacturers_referenced": ["Metrie", "Windsor One"],
    },
]


EMPLOYEES = [
    ("Lead Cabinet Maker",   "lead_cabinet_maker",  "2812", 38.00, 56.62, 0.490),
    ("Cabinet Maker A",      "cabinet_maker",       "2812", 32.00, 47.36, 0.480),
    ("Cabinet Maker B",      "cabinet_maker",       "2812", 32.00, 47.36, 0.480),
    ("CNC Operator",         "cnc_operator",        "2812", 36.00, 53.28, 0.480),
    ("Millwork Installer",   "millwork_installer",  "5645", 30.00, 45.00, 0.500),
    ("Finisher / Sprayer",   "millwork_finisher",   "2812", 30.00, 44.40, 0.480),
    ("Shop Helper",          "general_laborer",     "5606", 20.00, 28.60, 0.430),
]


def seed_company() -> str:
    execute(
        """
        INSERT INTO companies (id, name, primary_trade, segment, years_in_business,
                               size_band, annual_revenue_band, onboarded_at)
        VALUES (%s, %s, 'specialty_millwork', 'mixed', 22,
                '4-7 employees', '$1M-$2M', NOW())
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            segment = EXCLUDED.segment,
            onboarded_at = EXCLUDED.onboarded_at
        """,
        (COMPANY_ID, "Vantage Millwork & Cabinetry"),
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
            formatting = EXCLUDED.formatting
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
                typical_margin_pct = EXCLUDED.typical_margin_pct
            """,
            (
                COMPANY_ID, sl["line_name"], sl["typical_scope_text"],
                sl["standard_exclusions"],
                sl["pricing_unit"],
                json.dumps(sl["pricing_range_residential"]),
                json.dumps(sl["pricing_range_commercial"]),
                sl["typical_margin_pct"],
                sl["manufacturers_referenced"],
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
        ) VALUES (%s, 1.55, 1.30, 20.0, 30.0, 22.0, 38.0,
                  'fixed', 800, '50% deposit / net 30', 0.50)
        ON CONFLICT (company_id) DO UPDATE SET
            target_margin_pct = EXCLUDED.target_margin_pct,
            capacity_discount_behavior = EXCLUDED.capacity_discount_behavior,
            deposit_pct = EXCLUDED.deposit_pct
        """,
        (COMPANY_ID,),
    )


def seed_employees() -> None:
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
            ) VALUES (%s, %s, 0.0765, 0.006, 0.024, 6.20, 1.0,
                      820, 7.2, 0.03, 80, 350, 50, %s, %s)
            """,
            (emp_id, date(2026, 1, 1), burden, loaded),
        )


def _generate_historical_bids() -> None:
    """Higher volume, smaller quotes, lower margin variance vs Cavy.

    Vantage runs ~3-4 quotes per week ($800-$45K range, median ~$8K).
    """
    from core.db import fetch_all

    emps = fetch_all(
        "SELECT id, trade_classification FROM employees WHERE company_id = %s",
        (COMPANY_ID,),
    )
    plan = [
        ("INTERIOR-DOORS",         24, (800, 6500),  0.28, 0.03),
        ("BASE-CASING",            18, (500, 3200),  0.25, 0.02),
        ("CUSTOM-CABINETRY",       14, (4500, 38000), 0.32, 0.04),
        ("ARCHITECTURAL-PANELS",    8, (12000, 60000), 0.38, 0.04),
    ]
    base_day = date.today() - timedelta(days=420)
    bid_idx = 0
    for service_line, n_jobs, (low, high), target_margin, var_sigma in plan:
        for _ in range(n_jobs):
            bid_id = str(uuid.uuid4())
            quoted_value = round(random.uniform(low, high), 2)
            quoted_hours = max(8, int(quoted_value / random.uniform(140, 220)))
            quoted_labor_cost = round(quoted_hours * random.uniform(42, 56), 2)
            quoted_material_cost = round(quoted_value * random.uniform(0.32, 0.48), 2)
            client_name = f"Builder #{2000+bid_idx}"
            created = base_day + timedelta(days=bid_idx * 5)
            start = created + timedelta(days=14)
            outcome = random.choices(
                ["WON", "LOST", "STALLED", "NO_DECISION"],
                weights=[0.72, 0.18, 0.06, 0.04],
            )[0]
            state = {"WON": "RECONCILED"}.get(outcome, outcome)
            pricing_breakdown = {
                "service_line": service_line,
                "labor": {"total_hours": quoted_hours, "subtotal": quoted_labor_cost},
                "materials": {"subtotal": quoted_material_cost},
                "overhead": {"subtotal": round(quoted_value * 0.20, 2)},
                "profit": {"subtotal": round(quoted_value * target_margin, 2),
                           "target_margin_pct": target_margin * 100},
                "target_price": quoted_value,
                "range_low": round(quoted_value * 0.94, 2),
                "range_high": round(quoted_value * 1.08, 2),
            }
            execute(
                """
                INSERT INTO bids (
                    id, company_id, state, service_line, client_name, client_segment,
                    scope_summary, estimated_value, estimated_labor_hours,
                    estimated_start_date, pricing_breakdown,
                    created_at, draft_generated_at, sent_at,
                    outcome, outcome_competitor, outcome_captured_at,
                    exclusions_applied
                ) VALUES (%s,%s,%s,%s,%s,'mixed',
                          %s,%s,%s,%s,%s,
                          %s,%s,%s,
                          %s,%s,%s,
                          %s)
                """,
                (
                    bid_id, COMPANY_ID, state, service_line, client_name,
                    f"{service_line} package for {client_name}",
                    quoted_value, quoted_hours, start, json.dumps(pricing_breakdown),
                    datetime.combine(created, datetime.min.time()),
                    datetime.combine(created + timedelta(days=1), datetime.min.time()),
                    datetime.combine(created + timedelta(days=2), datetime.min.time()),
                    outcome,
                    random.choice(["WoodCraft Pacific", "Island Millworks", "Custom Cabinetry HI"])
                    if outcome == "LOST" else None,
                    datetime.combine(created + timedelta(days=10), datetime.min.time())
                    if outcome != "WON" else None,
                    next((sl["standard_exclusions"][:3] for sl in SERVICE_LINES
                          if sl["line_name"] == service_line), []),
                ),
            )
            if outcome == "WON":
                labor_var = random.gauss(0.0, var_sigma)
                actual_hours = max(1, int(quoted_hours * (1 + labor_var)))
                avg_loaded = 47.0
                actual_labor_cost = round(actual_hours * avg_loaded, 2)
                actual_material_cost = round(quoted_material_cost * random.uniform(0.97, 1.05), 2)
                actual_total = actual_labor_cost + actual_material_cost
                delivered_margin = round((quoted_value - actual_total) / quoted_value * 100, 2)
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
                        delivered_margin, round(labor_var*100, 2), var_total_pct,
                        datetime.combine(start + timedelta(days=30), datetime.min.time()),
                    ),
                )
                execute(
                    """
                    UPDATE bids SET actual_labor_hours = %s, actual_cost_total = %s,
                                    delivered_margin_pct = %s
                    WHERE id = %s
                    """,
                    (actual_hours, actual_total, delivered_margin, bid_id),
                )
            bid_idx += 1


def run() -> None:
    from db.seed_utils import wipe_company_data

    print(f"Wiping prior data for company {COMPANY_ID}...")
    wipe_company_data(COMPANY_ID)
    print(f"Seeding Archetype B (Vantage Millwork) company {COMPANY_ID}...")
    seed_company()
    seed_voice()
    seed_service_lines()
    seed_pricing_logic()
    seed_employees()
    print("Generating ~64 historical bids for Vantage Millwork...")
    _generate_historical_bids()
    n = fetch_one("SELECT COUNT(*) AS n FROM bids WHERE company_id = %s", (COMPANY_ID,))["n"]
    print(f"Done. Bids: {n}")


if __name__ == "__main__":
    run()
