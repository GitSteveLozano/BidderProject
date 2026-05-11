# ProService Bid Intelligence

Multi-agent AI platform that helps SMB specialty contractors operate more
effectively across the full bid lifecycle — from RFP/scope intake through
job-cost reconciliation.

> **Status:** Day 0–2 scaffold per
> `docs/architecture_spec_v2.md`. Most agent logic is contract-only; the
> orchestrator state machine, schemas, and seed data are real.

## Architecture in one paragraph

Eight specialized agents (Orchestrator, Intake, Context, Pricing,
Composition, Job-Cost Reconciliation, Follow-up, Intelligence) coordinate
over a shared Postgres + pgvector context store. The Pricing and JCR agents
are tool-grounded — they query real (or simulated) loaded labor data rather
than generating numbers. The Composition agent verifies standard exclusions
before marking a draft ready. The Intelligence agent runs async over
aggregated state to surface capacity-aware insights.

See `docs/architecture_spec_v2.md` for the full specification.

## Layout

```
/agents         8 agent modules — public contracts in spec §5
/tools          Tool functions agents call (PDF, vector, labor, capacity, ...)
/db             schema.sql + migrations + seed_data/
/api            FastAPI app + routes
/ui             Streamlit demo UI
/data           raw + processed corpus
/tests          Unit tests for state machine, pricing, exclusions, JCR
/docs           Architecture spec, brief skeleton
```

## Running locally

Requires Python 3.11+, Postgres 15+ with the `pgvector` extension, and an
Anthropic API key.

```bash
# 1. Install
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"

# 2. Configure
cp .env.example .env
# edit .env with ANTHROPIC_API_KEY and DATABASE_URL

# 3. Initialize DB
psql "$DATABASE_URL" -f db/schema.sql
python -m db.seed   # loads simulated payroll + schedule + bid history

# 4. Run API
uvicorn api.main:app --reload

# 5. Run demo UI (separate terminal)
streamlit run ui/streamlit_app.py
```

## Models

Per spec §12.1, updated to current Claude 4.x model IDs:

| Role                                      | Model              |
| ----------------------------------------- | ------------------ |
| Orchestrator routing, Intake extraction   | `claude-haiku-4-5` |
| Composition, Context, JCR, Follow-up      | `claude-sonnet-4-6` |
| Intelligence (cross-cutting synthesis)    | `claude-sonnet-4-6` |

Embeddings: `text-embedding-3-small` (1536 dims, pgvector-friendly).

## Tests

```bash
pytest
```

## Build sequence

This repo follows the 7-day build sequence in spec §9. Day 0 (scaffold) and
Day 2 (foundation) are committed here; Days 3–7 are tracked as roadmap.
