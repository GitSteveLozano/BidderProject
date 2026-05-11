# ProService Bid Intelligence

Multi-agent AI platform that helps SMB specialty contractors operate more
effectively across the full bid lifecycle — from RFP/scope intake through
job-cost reconciliation.

> **Static site:** <https://gitstevelozano.github.io/BidderProject/>
> (auto-deploys from `docs/`).
> **Interactive demo:** local only, see [Running locally](#running-locally) below.

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

### Option A — Docker Compose (recommended)

```bash
cp .env.example .env    # add ANTHROPIC_API_KEY (and optionally OPENAI_API_KEY)
docker compose up --build
docker compose exec api python -m db.seed_all
```

Then open:
- UI: http://localhost:8501
- API docs: http://localhost:8000/docs

### Option B — Local Python

Requires Python 3.11+, Postgres 15+ with `pgvector`, and Redis.

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env

# Initialize DB
psql "$DATABASE_URL" -f db/schema.sql
python -m db.seed_all   # all 3 archetypes (Cavy stucco, Vantage millwork, agency)

# Run services in separate terminals
uvicorn api.main:app --reload
streamlit run ui/streamlit_app.py
celery -A core.celery_app worker --loglevel=INFO
celery -A core.celery_app beat --loglevel=INFO
```

### CLI

```bash
python cli.py health             # check DB + schema + companies
python cli.py seed --archetype a # seed just Archetype A
python cli.py ingest             # bulk-load data/raw/ past quotes + samples
python cli.py demo               # run end-to-end demo flow
python cli.py capacity --company-id <uuid>
python cli.py intelligence --company-id <uuid>
python cli.py reset --yes        # wipe and re-seed (spec §11 Risk 2)
```

### Or via `just`

```bash
just install         # pip install -e ".[dev]"
just schema          # apply db/schema.sql
just seed            # seed all 3 archetypes
just ingest          # bulk-load corpus
just test            # run pytest
just api             # uvicorn with reload
just ui              # streamlit
just up              # docker compose up
just reset           # wipe + re-seed
```

### Demo

See `docs/demo_storyboard.md` for the 7.5-minute walkthrough mapped to
spec §8.6.

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
