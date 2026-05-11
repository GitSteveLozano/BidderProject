---
title: Deploy to Streamlit Community Cloud
---

# Deploy to Streamlit Community Cloud

This is the lightest path to a clickable, shareable demo without
running a server. Streamlit Cloud is free for public repos and
auto-deploys on every push.

**Total time:** ~15 minutes once you have the accounts.

**Cost:** $0. Free Supabase project (500 MB Postgres, 2 GB transfer)
+ free Streamlit Cloud account is enough for demo traffic.

---

## What you'll need

1. A GitHub account that owns this repo (you have one).
2. A Supabase account (sign up at <https://supabase.com>; GitHub OAuth works).
3. A Streamlit Community Cloud account (sign up at
   <https://streamlit.io/cloud>; GitHub OAuth works).
4. An Anthropic API key.
5. *(Optional)* An OpenAI API key for real pgvector embeddings — without
   it the system stores zero vectors, which works fine for the demo.

---

## Step 1 — Create the Supabase database

1. <https://supabase.com/dashboard> → "New project".
2. Name: `bidintel-demo`. Region: closest to you. Password: generate
   and save it.
3. Wait ~2 min for the project to provision.
4. Once it's up, go to **Database → Extensions** and enable `vector`
   (pgvector). Toggle the switch — Supabase preinstalls it.
5. **Database → Connection string → URI**. Copy the **Session pooler**
   URL (not Transaction pooler — `psycopg` connection pool expects a
   long-lived connection). It looks like:
   ```
   postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres
   ```
6. Replace `[YOUR-PASSWORD]` in the string with the password you set.

---

## Step 2 — Deploy to Streamlit Cloud

1. <https://share.streamlit.io> → "New app".
2. Pick the repo (`GitStevelozano/BidderProject`) and the branch
   (`main` once you've merged, or `claude/setup-bidder-project-1gDWl`
   for now).
3. **Main file path:** `streamlit_app.py` (at the repo root — it
   delegates to `ui/streamlit_app.py`).
4. **App URL:** customize the subdomain or accept the default.
5. **Advanced settings → Secrets:** paste the TOML below (using your
   real values from steps above). The same content lives at
   `.streamlit/secrets.toml.example` in the repo for reference.

```toml
ANTHROPIC_API_KEY = "sk-ant-..."
OPENAI_API_KEY    = "sk-..."

# Use Supabase's Session pooler — NOT Transaction.
DATABASE_URL = "postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"

AUTO_SEED = "true"
USE_TOOL_USE_PRICING = "false"
DEMO_COMPANY_ID = "00000000-0000-0000-0000-000000000001"
```

6. Click **Deploy**. First boot takes ~3-5 min — Streamlit Cloud
   provisions the container, installs `requirements.txt`, and starts
   the app. The `streamlit_app.py` shim auto-applies `db/schema.sql`
   and runs `db.seed_all` against the empty Supabase database on first
   load.

---

## Step 3 — Verify

Open the deployed URL. You should see:

1. The sidebar populated with 3 companies (Honolulu Stucco & Exteriors,
   Vantage Millwork, Honolulu Brand Co.).
2. The **Active Bids** page showing the seeded historical bids
   (~64 for Vantage, ~40 for Cavy archetype).
3. The **Intelligence Dashboard** with starter insights and the
   margin heatmap rendering.

If the sidebar is empty or you see a connection error, check the
**Manage app → Logs** view in Streamlit Cloud — the bootstrap shim
logs schema/seed errors via the structured logger.

---

## Cost and limits

| Resource              | Free tier               | Demo usage estimate         |
| --------------------- | ----------------------- | --------------------------- |
| Streamlit Cloud       | 1 app, public repo      | 1 of 1                      |
| Supabase Postgres     | 500 MB                  | ~5 MB seeded                |
| Supabase egress       | 2 GB/month              | ~10 MB per session          |
| Anthropic             | pay-as-you-go           | ~$0.10 per generated bid    |
| pgvector indexing     | included                | n/a (zero vectors w/o OpenAI key) |

**Anthropic pricing**: the **Estimate input cost** button on the Bid
Generation page shows tokens + USD before generation. With prompt
caching enabled, repeat bids for the same company are ~90% cheaper on
the input side.

---

## Updating the deployment

Push to the branch Streamlit Cloud is watching. Streamlit auto-rebuilds
within ~30 seconds.

To switch the watched branch (e.g., after merging to `main`):
**Manage app → Settings → Branch** → pick.

---

## Resetting the demo data

The bootstrap only seeds when the DB is empty. To re-seed:

1. Streamlit Cloud → **Manage app → Reboot**.
2. Or manually: connect to Supabase via psql and run
   `TRUNCATE companies CASCADE` — next boot re-seeds.
3. Or set `AUTO_SEED=false` and run the CLI from your laptop against
   the Supabase URL: `python cli.py reset --yes`.

---

## When you outgrow this

Streamlit Cloud is fine for the demo. For more than a handful of
concurrent users or for the FastAPI surface (which isn't deployed
here), move to Docker on Render / Railway / Fly.io. The
`docker-compose.yml` in the repo runs the full stack — Postgres,
Redis, API, UI, Celery worker + beat — and any of those PaaS
providers can host the same image. The `Dockerfile` is the source of
truth.
