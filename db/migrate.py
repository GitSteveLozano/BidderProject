"""Minimal migration runner.

Tracks applied migrations in `schema_migrations` table. Applies any
.sql file under db/migrations/ whose number hasn't run yet.

Run: python -m db.migrate
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from core.db import execute, fetch_all

MIGRATIONS_DIR = Path(__file__).parent / "migrations"


def ensure_table() -> None:
    execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version     TEXT PRIMARY KEY,
            applied_at  TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )


def applied_versions() -> set[str]:
    rows = fetch_all("SELECT version FROM schema_migrations")
    return {r["version"] for r in rows}


def discover() -> list[tuple[str, Path]]:
    out = []
    for f in sorted(MIGRATIONS_DIR.glob("*.sql")):
        m = re.match(r"^(\d{4})_", f.name)
        if not m:
            continue
        out.append((m.group(1), f))
    return out


def run() -> int:
    if not MIGRATIONS_DIR.exists():
        print("(no migrations dir)")
        return 0
    ensure_table()
    applied = applied_versions()
    pending = [(v, f) for v, f in discover() if v not in applied]
    if not pending:
        print("All migrations up to date.")
        return 0
    for version, path in pending:
        print(f"Applying {version} — {path.name}")
        sql = path.read_text()
        # The provided migrations use `\i db/schema.sql` which is psql
        # client meta-syntax. Resolve that one case ourselves.
        if r"\i db/schema.sql" in sql:
            sql = (Path(__file__).parent / "schema.sql").read_text()
        execute(sql)
        execute(
            "INSERT INTO schema_migrations (version) VALUES (%s)",
            (version,),
        )
    print(f"Applied {len(pending)} migration(s).")
    return 0


if __name__ == "__main__":
    sys.exit(run())
