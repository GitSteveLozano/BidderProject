# Common dev commands. Run: `just <recipe>`.
# Install just: brew install just  OR  cargo install just

set dotenv-load := true

# Default — list available recipes
default:
    @just --list

# Install deps + dev tooling
install:
    pip install -e ".[dev]"

# Apply schema to a running Postgres
schema:
    psql "$DATABASE_URL" -f db/schema.sql

# Seed all three archetypes (Cavy stucco, Vantage millwork, agency)
seed:
    python -m db.seed_all

# Seed a single archetype: just seed-one a   /   b   /   c
seed-one ARCHETYPE:
    python -m db.seed_archetype_{{ARCHETYPE}}

# Bulk-ingest data/raw/ into the documents table (with embeddings)
ingest:
    python cli.py ingest

# Run tests
test:
    pytest -v

# Run a focused test path
test-one PATH:
    pytest -v {{PATH}}

# Run linter
lint:
    ruff check .

# Auto-fix lint issues
lint-fix:
    ruff check --fix .

# Run the FastAPI server with auto-reload
api:
    uvicorn api.main:app --reload

# Run the Streamlit UI
ui:
    streamlit run ui/streamlit_app.py

# Run Celery worker (follow-ups, intelligence, JCR patterns)
worker:
    celery -A core.celery_app worker --loglevel=INFO

# Run Celery beat scheduler
beat:
    celery -A core.celery_app beat --loglevel=INFO

# Health check (DB + schema + companies)
health:
    python cli.py health

# Run the full demo flow end-to-end (CLI)
demo:
    python cli.py demo

# Show capacity forecast for the demo company
capacity:
    python cli.py capacity --company-id $DEMO_COMPANY_ID

# Run Intelligence agent for the demo company
intelligence:
    python cli.py intelligence --company-id $DEMO_COMPANY_ID

# Reset the demo to clean state and re-seed (spec §11 Risk 2)
reset:
    python cli.py reset --yes

# Compile docs/*.md (brief, spec, storyboard) to PDFs in dist/
brief:
    python scripts/build_brief.py

# Tests with coverage report
cov:
    pytest --cov --cov-report=term-missing --cov-report=html

# Show coverage summary
cov-summary:
    pytest --cov --cov-report=term --no-header -q

# Docker Compose: bring up the stack
up:
    docker compose up -d --build

# Docker Compose: tear down
down:
    docker compose down

# Docker Compose: logs
logs:
    docker compose logs -f

# Initialize DB inside the running compose stack
docker-seed:
    docker compose exec api python -m db.seed_all
