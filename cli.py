"""Demo CLI.

Run: python cli.py --help

Provides the demo flows from spec §8.6 without the UI, plus health
checks and a reset-to-clean-state command (spec §11 Risk 2 mitigation).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta


def cmd_health(args) -> int:
    """Quick health check: DB connectivity + schema present + companies count."""
    from core.db import fetch_one

    print("→ Checking DB connectivity...")
    try:
        row = fetch_one("SELECT 1 AS ok")
        if row and row.get("ok") == 1:
            print("  ✓ DB reachable")
        else:
            print("  ✗ DB query returned unexpected result")
            return 1
    except Exception as e:
        print(f"  ✗ DB error: {e}")
        return 1

    print("→ Checking pgvector extension...")
    try:
        ext = fetch_one("SELECT extname FROM pg_extension WHERE extname = 'vector'")
        print("  ✓ pgvector installed" if ext else "  ✗ pgvector NOT installed")
    except Exception as e:
        print(f"  ! could not check pgvector: {e}")

    print("→ Checking schema...")
    try:
        n = fetch_one(
            "SELECT COUNT(*) AS n FROM information_schema.tables "
            "WHERE table_schema='public' AND table_name='bids'"
        )
        print("  ✓ bids table exists" if (n and n["n"]) else "  ✗ bids table missing")
    except Exception as e:
        print(f"  ✗ schema check failed: {e}")
        return 1

    print("→ Companies in DB:")
    try:
        from core.db import fetch_all

        rows = fetch_all("SELECT name, segment FROM companies")
        for r in rows:
            print(f"  • {r['name']} ({r['segment']})")
        if not rows:
            print("  (none — run `python cli.py seed`)")
    except Exception as e:
        print(f"  ! could not list companies: {e}")
    return 0


def cmd_seed(args) -> int:
    """Run all archetype seeds."""
    if args.archetype == "a":
        from db import seed
        seed.run()
    elif args.archetype == "b":
        from db import seed_archetype_b
        seed_archetype_b.run()
    elif args.archetype == "c":
        from db import seed_archetype_c
        seed_archetype_c.run()
    else:
        from db import seed_all
        seed_all.run()
    return 0


def cmd_reset(args) -> int:
    """Wipe all data and re-seed. Demo §11 Risk 2 mitigation."""
    if not args.yes:
        print("This DELETES all data and re-runs seed_all.")
        confirm = input("Type 'reset' to confirm: ")
        if confirm.strip().lower() != "reset":
            print("Cancelled.")
            return 1

    from core.db import execute

    tables = [
        "intelligence_insights", "job_cost_reconciliation",
        "schedule_allocations", "follow_ups", "bid_state_history",
        "burden_components", "employees", "prevailing_wages",
        "documents", "scope_patterns", "pricing_logic",
        "service_lines", "voice_patterns", "bids", "companies",
    ]
    for t in tables:
        print(f"  TRUNCATE {t}")
        execute(f"TRUNCATE TABLE {t} RESTART IDENTITY CASCADE")
    print("\n→ Re-seeding all archetypes...\n")
    from db import seed_all
    seed_all.run()
    return 0


def cmd_intelligence(args) -> int:
    """Run the Intelligence agent for a company."""
    from agents import intelligence

    print(f"→ Running Intelligence agent for {args.company_id}...")
    generated = intelligence.run_weekly_analysis(args.company_id)
    print(json.dumps(generated, indent=2, default=str))
    return 0


def cmd_capacity(args) -> int:
    """Print the capacity forecast for a company."""
    from tools.capacity_lookup import get_capacity_utilization

    start = date.today() if not args.start else date.fromisoformat(args.start)
    result = get_capacity_utilization(args.company_id, start, weeks=args.weeks)
    print(f"Headcount: {result['headcount']}")
    print(f"Capacity / week: {result.get('capacity_hours_per_week', 0)} hours")
    print(f"Avg utilization: {int(result['avg_utilization']*100)}%")
    print()
    for w in result["weeks"]:
        bar = "█" * int(w["utilization"] * 30)
        print(f"  {w['week_start']}  {int(w['utilization']*100):3d}%  {bar}")
    return 0


def cmd_demo(args) -> int:
    """Run the full demo flow end-to-end. Useful for sanity checks before a live demo."""
    from agents import orchestrator
    from core.settings import get_settings

    company_id = args.company_id or get_settings().demo_company_id
    print("=== DEMO FLOW ===\n")

    print("Step 1: create bid (Esprit Heights Phase 2)")
    bid_id = orchestrator.create_bid(
        company_id=company_id,
        client_name="Esprit Heights Phase 2 — McKenzie GC",
        service_line="EIFS",
        scope_summary="EIFS exterior, ~3,200 sqft, ADEX system, multi-unit residential",
        client_segment="repeat",
        estimated_start_date=date.today() + timedelta(weeks=4),
    )
    print(f"  Created bid: {bid_id}")

    print("\nStep 2: run assessment (Pricing + Composition agents)")
    result = orchestrator.run_assessment(
        bid_id=bid_id,
        labor_plan=[
            {"trade": "eifs", "hours": 312},
            {"trade": "helper", "hours": 80},
        ],
        material_quantity=3200,
    )
    print(f"  State: {result['state']}")
    print(f"  Target price: ${result['pricing']['target_price']:,.2f}")
    print(f"  Range: ${result['pricing']['range_low']:,.0f} – "
          f"${result['pricing']['range_high']:,.0f}")
    print(f"  Capacity at start: {int(result['pricing']['capacity_utilization_at_start']*100)}%")
    print(f"  Modifier: {result['pricing']['capacity_modifier']['action']}")
    if result["composition"]["exclusions_missing"]:
        print(f"  ⚠  Exclusions missing: {result['composition']['exclusions_missing']}")
    else:
        print(f"  ✓  {result['composition']['total_required']} exclusions verified present")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="ProService Bid Intelligence — demo CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_health = sub.add_parser("health", help="check DB / schema / data presence")
    p_health.set_defaults(func=cmd_health)

    p_seed = sub.add_parser("seed", help="seed archetypes")
    p_seed.add_argument("--archetype", choices=["a", "b", "c", "all"], default="all")
    p_seed.set_defaults(func=cmd_seed)

    p_reset = sub.add_parser("reset", help="wipe and re-seed (DANGEROUS)")
    p_reset.add_argument("--yes", action="store_true", help="skip confirmation prompt")
    p_reset.set_defaults(func=cmd_reset)

    p_intel = sub.add_parser("intelligence", help="run Intelligence agent")
    p_intel.add_argument("--company-id", required=True)
    p_intel.set_defaults(func=cmd_intelligence)

    p_cap = sub.add_parser("capacity", help="show capacity forecast")
    p_cap.add_argument("--company-id", required=True)
    p_cap.add_argument("--start", help="ISO date (default: today)")
    p_cap.add_argument("--weeks", type=int, default=8)
    p_cap.set_defaults(func=cmd_capacity)

    p_demo = sub.add_parser("demo", help="run the full demo flow end-to-end")
    p_demo.add_argument("--company-id", help="defaults to DEMO_COMPANY_ID")
    p_demo.set_defaults(func=cmd_demo)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
