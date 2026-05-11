# Seed Supabase via the SQL Editor (no Python needed)

This is the one-shot path: paste a single SQL file into Supabase's SQL
Editor and you get a fully seeded demo database. ~10 seconds to run.

## What gets seeded

Generated from `db/seed_all.py` (the canonical Python seed) by running
it against a temp Postgres and dumping the resulting rows:

- **3 archetype companies** (Honolulu Stucco, Vantage Millwork,
  Honolulu Brand Co.) with their pricing logic, voice patterns, scope
  patterns.
- **~25 employees** across the three companies + their burden
  components (loaded hourly rates, FICA, workers' comp, etc.).
- **service_lines** per company (EIFS, STUCCO-CONVENTIONAL, METAL WORK
  for Honolulu Stucco; INTERIOR-DOORS, CABINETRY for Vantage; etc.).
- **~140 historical bids** with realistic outcomes (WON / LOST), 29 of
  them reconciled via `job_cost_reconciliation` so the Layer 4 JCR view
  shows real variance data.
- **prevailing_wages** for Honolulu County.
- **5 starter intelligence insights** so the Layer 5 dashboard isn't
  empty on day one.
- **schedule_allocations** for ~12 weeks (capacity utilization curve
  per the architecture spec §8.5).

## Steps

1. Open your Supabase project → **SQL Editor** (left nav) → **New
   query**.
2. Open [`db/seed_supabase.sql`](../db/seed_supabase.sql) in another
   tab, **select all (Ctrl+A)**, **copy (Ctrl+C)**.
3. Paste into the Supabase SQL Editor.
4. Click **Run** (or Cmd/Ctrl + Enter). Takes ~5-10 seconds.

You should see:
```
Success. No rows returned
```

The TRUNCATE statements at the top make this safe to re-run — every
re-run wipes the previous data and reinserts cleanly.

## Verify

After running, hit `/api/health` on your Cloudflare Pages deploy:
```
https://bidderproject.pages.dev/api/health
```

You should now see `"companies_count": 3` and the SSR pages
(`/bids`, `/jcr`, `/insights`, `/postmortem`) will populate with real
data.

## Why this exists

The Cloudflare Pages SPA doesn't have a "first boot" hook to auto-seed
the way the Streamlit Cloud deployment does (its bootstrap shim in
`streamlit_app.py` runs `db.seed_all` automatically on cold start).
Since most users won't have Python set up locally, pre-baking the seed
into a SQL file is the lowest-friction onboarding path.

## Regenerating

If `db/seed_all.py` changes (new archetypes, more bids, schema
additions), regenerate `db/seed_supabase.sql`:

```bash
# Spin up a local Postgres, apply schema, run the seed,
# dump the result, run clean_dump.py to strip psql-isms.
sudo service postgresql start
sudo -u postgres psql -c "CREATE DATABASE bidintel_seed;"
sudo -u postgres psql -d bidintel_seed -c "CREATE EXTENSION vector;"
sudo -u postgres psql -d bidintel_seed -f db/schema.sql
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/bidintel_seed" \
  python -m db.seed_all
sudo -u postgres pg_dump --data-only --no-owner --no-privileges \
  --column-inserts --disable-triggers bidintel_seed > /tmp/raw.sql
# Then strip psql-only directives and prepend TRUNCATEs — see the
# script in `scripts/clean_dump.py` (TODO: factor out the inline
# version once we regenerate again).
```
