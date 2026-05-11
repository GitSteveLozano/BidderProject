---
title: Streamlit Cloud — fastest path to a live demo
---

# Streamlit Cloud — fastest path to a live demo

**Goal:** a clickable URL you can share for the interactive demo.

**Time:** ~15 minutes start-to-finish.

**Cost:** $0. Free Supabase Postgres + free Streamlit Cloud. Anthropic API
calls bill pay-as-you-go (~$0.10 per generated bid; the **Estimate input
cost** button on the Bid Generation page shows the number before you
click "Run all 4 generation agents").

The full background and reset/migration paths live in
[the long deployment guide]({{ "/deployment/streamlit-cloud.html" | relative_url }}).
This page is just the run-through.

---

## Step 1 — Supabase project (5 min)

1. <https://supabase.com> → **Start your project** → sign in with GitHub.
2. **New project**:
   - Name: `bidintel-demo`
   - Database password: click **Generate a password** and **save it to
     your password manager**. You won't see it again.
   - Region: closest to you (or where your users are).
   - Plan: **Free**.
3. Wait ~2 minutes for provisioning. Refresh until "Project online".
4. **Database** (left nav) → **Extensions** → search for **`vector`** →
   toggle it on. (Supabase ships with `pgvector` preinstalled; you're
   just enabling it for this DB.)
5. **Project Settings** (gear icon, bottom-left) → **Database** →
   **Connection string** → tab **URI**. There are two pooler endpoints:
   - **❌ Transaction pooler** (port 6543) — DON'T use, psycopg's
     connection pool needs a long-lived connection.
   - **✅ Session pooler** (port 5432) — copy this one.

   It looks like:
   ```
   postgresql://postgres.PROJECT:[YOUR-PASSWORD]@aws-0-REGION.pooler.supabase.com:5432/postgres
   ```

   Replace `[YOUR-PASSWORD]` with the password you saved in step 2.

---

## Step 2 — Streamlit Cloud app (8 min)

1. <https://share.streamlit.io> → **Continue with GitHub** → authorize.
2. **New app** (top right) → **From existing repo**.
3. Form:
   - **Repository:** `GitSteveLozano/BidderProject`
   - **Branch:** `main`
   - **Main file path:** `streamlit_app.py` (← at the repo root, not
     `ui/streamlit_app.py`. The root file is the Cloud entry point that
     auto-applies the schema and seeds the demo data.)
   - **App URL:** customize the subdomain or accept the default.
4. **Advanced settings** → **Secrets** → paste this TOML (your real
   values):

   ```toml
   ANTHROPIC_API_KEY = "sk-ant-..."
   OPENAI_API_KEY    = "sk-..."  # optional — without it, embeddings are zero vectors

   DATABASE_URL = "postgresql://postgres.PROJECT:PASSWORD@aws-0-REGION.pooler.supabase.com:5432/postgres"

   AUTO_SEED = "true"
   USE_TOOL_USE_PRICING = "false"
   DEMO_COMPANY_ID = "00000000-0000-0000-0000-000000000001"
   ```

5. Click **Deploy**.

First boot takes ~3-5 minutes:
- Cloudflare ... wait wrong — Streamlit Cloud provisions the container.
- Installs `requirements.txt` (~90 sec).
- Imports the app; the bootstrap shim in `streamlit_app.py` detects the
  empty database, applies `db/schema.sql`, and runs `db.seed_all` —
  inserting 3 archetype companies + ~100 historical bids + 5 starter
  insights.

You can watch progress in **Manage app → Logs**.

---

## Step 3 — Verify (2 min)

When the app loads, you should see:

- **Sidebar**: three companies (`Honolulu Stucco & Exteriors LLC`,
  `Vantage Millwork & Cabinetry`, `Honolulu Brand Co.`).
- **Active Bids** page: a table with ~40 historical bids (Cavy archetype).
- **Intelligence Dashboard**: starter insights + margin heatmap rendering.
- **Bid Generation**: form pre-filled with the Esprit Heights EIFS
  scope. Click **Estimate input cost** first to see the token count;
  then **Run all 4 generation agents** to generate a real bid in Cavy's
  voice.

If the sidebar is empty, check **Manage app → Logs** — the bootstrap shim
emits structured-JSON errors for schema or seed failures.

---

## Step 4 — Share the URL

Streamlit Cloud apps are public by default. You can lock them down via
**Manage app → Settings → Sharing**.

The app URL is `https://<your-subdomain>.streamlit.app`. Bookmark it,
share it with your case-exercise reviewers, embed it in a landing page.

To **update**, push to `main` — Streamlit Cloud rebuilds in ~30 seconds.

---

## Cost sanity-check

- Streamlit Cloud free tier: 1 app, public repo, sleeps after 7 days idle.
- Supabase free tier: 500 MB Postgres (you're at ~5 MB seeded), 2 GB
  monthly egress, 50K monthly active users on auth (you don't use auth).
- Anthropic: pay-as-you-go. ~$0.10 per generated bid with prompt
  caching enabled (which the codebase does by default for repeat bids
  on the same company).

For a demo handful of users hitting it 20-50 times each, expect total
costs under $5. The free tiers are plenty.

---

## When you outgrow this

| Need | Move to |
|---|---|
| More concurrent users | Render / Railway / Fly.io with the `docker-compose.yml` stack |
| Custom domain + product polish | Cloudflare Pages SPA (see `/web/`) |
| Real customer auth / RBAC | Auth layer is currently out-of-scope per spec §12.6 — would land in the FastAPI surface or the Cloudflare SPA before any paid pilots |

The Streamlit Cloud deployment is meant for the demo case-exercise
phase. The Cloudflare SPA in `/web/` is the long-term customer-facing
surface.
