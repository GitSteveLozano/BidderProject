"""Streamlit Community Cloud entry point.

Streamlit Cloud auto-discovers `streamlit_app.py` at the repo root.
This module just delegates to the real app in `ui/streamlit_app.py` so
the canonical layout (ui/ folder) doesn't change.

For local dev: keep using `streamlit run ui/streamlit_app.py`.
For Streamlit Cloud: this file is the entry point.

On first load against a fresh Supabase database, the bootstrap below
applies the schema and seeds the three archetypes — so the demo is
clickable immediately without a separate `python -m db.seed_all` step.
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

# Make repo modules importable when Streamlit runs from / on Cloud
sys.path.insert(0, str(Path(__file__).parent))

import streamlit as st  # noqa: E402

logger = logging.getLogger(__name__)


def _promote_secrets_to_env():
    """Streamlit Cloud injects ``st.secrets`` (TOML in Settings). Promote
    every key into os.environ so core.settings (pydantic-settings) picks
    them up. No-op when running locally without secrets configured.
    """
    try:
        for k, v in dict(st.secrets).items():
            # Nested secrets (TOML sections) come through as Mapping —
            # flatten one level: section.key → SECTION_KEY
            if hasattr(v, "items"):
                for sub_k, sub_v in v.items():
                    os.environ.setdefault(f"{k.upper()}_{sub_k.upper()}", str(sub_v))
            else:
                os.environ.setdefault(k.upper(), str(v))
    except Exception:
        # No secrets file → running locally with .env. Fine.
        pass


_promote_secrets_to_env()


@st.cache_resource(show_spinner=False)
def _bootstrap_db() -> dict:
    """Apply schema + seed archetypes on first load if the DB is empty.

    Cached for the lifetime of the process (st.cache_resource) so it
    runs once per app boot. Returns a dict the caller can render.
    """
    from core.db import execute, fetch_one

    state: dict = {"bootstrapped": False, "n_companies": 0}

    # Detect whether the schema has been applied
    try:
        n = fetch_one(
            "SELECT COUNT(*) AS n FROM information_schema.tables "
            "WHERE table_schema='public' AND table_name='bids'"
        )
        schema_present = bool(n and n["n"])
    except Exception as e:
        logger.warning("schema check failed: %s", e)
        schema_present = False

    if not schema_present:
        try:
            schema_sql = (Path(__file__).parent / "db" / "schema.sql").read_text()
            execute(schema_sql)
            state["bootstrapped"] = True
        except Exception as e:
            logger.exception("schema apply failed")
            state["bootstrap_error"] = str(e)
            return state

    # Detect whether seed data is loaded
    try:
        c = fetch_one("SELECT COUNT(*) AS n FROM companies")
        state["n_companies"] = int(c["n"]) if c else 0
    except Exception:
        state["n_companies"] = 0

    if state["n_companies"] == 0 and os.environ.get("AUTO_SEED", "true").lower() in (
        "1", "true", "yes",
    ):
        try:
            from db import seed_all

            seed_all.run()
            state["seeded"] = True
            c = fetch_one("SELECT COUNT(*) AS n FROM companies")
            state["n_companies"] = int(c["n"]) if c else 0
        except Exception as e:
            logger.exception("seed_all failed")
            state["seed_error"] = str(e)

    return state


def _surface_bootstrap_errors():
    """Show a friendly error if DB bootstrap failed — common on first
    Cloud deploys when DATABASE_URL or secrets aren't set yet."""
    try:
        result = _bootstrap_db()
    except Exception as e:
        st.error(
            f"Could not connect to the database: `{e}`.\n\n"
            "Streamlit Cloud users: set `DATABASE_URL` in Settings → "
            "Secrets. See `docs/deployment/streamlit-cloud.md`."
        )
        st.stop()
    if "bootstrap_error" in result:
        st.warning(
            f"Schema apply hit an issue: {result['bootstrap_error']}. "
            "Continuing — most existing-schema deployments are fine."
        )
    if "seed_error" in result:
        st.warning(f"Auto-seed failed: {result['seed_error']}")


_surface_bootstrap_errors()

# Hand off to the real app — runs the UI code as if launched directly.
exec(  # noqa: S102
    (Path(__file__).parent / "ui" / "streamlit_app.py").read_text(),
    {"__name__": "__main__", "__file__": "ui/streamlit_app.py"},
)
