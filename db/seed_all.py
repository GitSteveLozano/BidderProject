"""Seed all 3 archetypes — A (Cavy / stucco), B (Vantage / millwork), C (agency).

Run: python -m db.seed_all
"""
from __future__ import annotations

from db import seed as seed_a
from db import seed_archetype_b as seed_b
from db import seed_archetype_c as seed_c


def run() -> None:
    print("=== Archetype A — Honolulu Stucco & Exteriors ===")
    seed_a.run()
    print()
    print("=== Archetype B — Vantage Millwork ===")
    seed_b.run()
    print()
    print("=== Archetype C — Honolulu Brand Co. ===")
    seed_c.run()
    print()
    print("All archetypes seeded.")


if __name__ == "__main__":
    run()
