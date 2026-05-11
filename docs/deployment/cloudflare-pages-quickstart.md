---
title: Cloudflare Pages SPA — deploy walkthrough
---

# Cloudflare Pages SPA — deploy walkthrough

**Goal:** the SPA in `web/` live at a Cloudflare Pages URL, hitting your
Supabase Postgres and using your Anthropic API key.

**Time:** ~20 minutes start-to-finish if this is your first Cloudflare
deploy, ~10 minutes if you've shipped to Pages before.

**Cost:** $0 on the free tiers. Anthropic API calls bill pay-as-you-go.

---

## Prereqs

1. A Supabase project with the bidintel schema applied + demo data
   seeded. The Streamlit Cloud
   [quickstart]({{ "/deployment/streamlit-cloud-quickstart.html" | relative_url }})
   walks through Supabase setup; the same project works here.
2. A Cloudflare account (free): <https://dash.cloudflare.com/sign-up>.
3. An Anthropic API key: <https://console.anthropic.com/settings/keys>.

If you've already done the Streamlit Cloud quickstart, you have steps
1 + 3 — skip to step 2 below.

---

## Step 1 — Sanity-check Supabase

In your Supabase project's **SQL Editor**, run:

```sql
SELECT COUNT(*) FROM companies;     -- expect 3 (after running db.seed_all)
SELECT COUNT(*) FROM bids;          -- expect ~100
SELECT COUNT(*) FROM intelligence_insights;  -- expect 5+
```

If the schema isn't applied yet:

```bash
# From your local machine, in the project root:
psql "$SUPABASE_URL_with_password" -f db/schema.sql
python -m db.seed_all
```

The `SUPABASE_URL_with_password` is the Session pooler URI from
**Database → Connection string → URI**.

Grab the two values you'll need from **Project Settings → API**:

- **Project URL** (looks like `https://<id>.supabase.co`) — this is `SUPABASE_URL`
- **anon public** key — this is `SUPABASE_ANON_KEY`
- **service_role secret** key — this is `SUPABASE_SERVICE_KEY` (writes)

Keep the service_role key safe; it bypasses Postgres RLS.

---

## Step 2 — Connect Cloudflare Pages to the repo (5 min)

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Pages** tab
   → **Create application** → **Connect to Git**.
2. Authorize Cloudflare to read your GitHub repos. Pick
   `GitSteveLozano/BidderProject`.
3. **Set up builds and deployments** — these settings tell Cloudflare to
   build inside `web/` (a monorepo subdirectory) so Pages Functions in
   `web/functions/` are colocated with the build output:
   - **Project name:** `proservice-bid-intelligence` (or whatever — this
     becomes part of your `*.pages.dev` URL)
   - **Production branch:** `main`
   - **Framework preset:** None (Astro isn't in the dropdown for
     subdirectory builds; we set commands manually)
   - **Root directory (Advanced):** **`web`**  ← critical, treats `web/`
     as the project root
   - **Build command:** `npm install && npm run build`
   - **Build output directory:** `dist` (relative to the root above —
     resolves to `web/dist/`)
   - **Node.js version:** add a build-time env var `NODE_VERSION` = `20`
4. Click **Save and Deploy**. First build takes ~3-4 min.

> **If you see "Could not detect a directory containing static files":**
> the Root directory + Build output directory aren't aligned. Either
> set Root directory = `web` and output = `dist`, OR leave Root blank
> and use output = `web/dist` with build command `cd web && npm
> install && npm run build`. The first form is preferred — it makes
> Pages Functions discovery automatic.

The build will succeed but the deployed app won't function yet — it
needs runtime env vars + the `nodejs_compat` flag (next steps).

> **If you see "It looks like you've run a Workers-specific command in
> a Pages project":** delete `web/wrangler.toml` if it exists (the
> Cloudflare build harness sometimes misclassifies a Pages project as
> Workers when wrangler.toml is in the build root). This repo no
> longer ships a wrangler.toml for exactly this reason — everything
> wrangler.toml would configure is set in the Pages dashboard instead.

---

## Step 3 — Functions compatibility flags (1 min)

The Anthropic SDK and the Supabase JS client both depend on Node.js
builtins (`stream`, `events`, `buffer`). Cloudflare Workers needs
`nodejs_compat` to polyfill them.

1. Pages dashboard → your project → **Settings → Functions**.
2. Under **Compatibility flags**, click **Edit** for **Production**.
3. Add `nodejs_compat`. Save.
4. Repeat for **Preview**.
5. Under **Compatibility date**, set `2026-01-01` (or today's date).
   Apply to both Production and Preview.

These changes take effect on the **next** deployment, not retroactively.

---

## Step 4 — Configure runtime secrets

1. Pages dashboard → your project → **Settings → Environment variables**.
2. Click **Production** tab → **Add variable** for each of:

   | Variable | Type | Value |
   | --- | --- | --- |
   | `ANTHROPIC_API_KEY` | **Encrypt** | `sk-ant-...` |
   | `SUPABASE_URL` | Plaintext | `https://<id>.supabase.co` |
   | `SUPABASE_ANON_KEY` | **Encrypt** | the anon key |
   | `SUPABASE_SERVICE_KEY` | **Encrypt** | the service_role key |
   | `DEFAULT_MODEL_SONNET` | Plaintext | `claude-sonnet-4-6` |
   | `DEFAULT_MODEL_HAIKU` | Plaintext | `claude-haiku-4-5` |

3. Toggle the encrypt switch on for anything secret. Pages stores them
   one-way encrypted; you can rotate but not view.
4. **Redeploy**: Deployments tab → click **...** → **Retry
   deployment**. (Env vars don't take effect on existing deployments.)

---

## Step 5 — Verify (2 min)

Open `https://<project-name>.pages.dev`. You should see:

1. The hero page with the 5-layer overview.
2. **/bids** lists the seeded historical bids (~40 for the Cavy archetype).
3. **/jcr** shows reconciled jobs with variance percentages.
4. **/insights** shows the 5 starter insights.
5. **/generate** → fill in the pre-filled scope and click "Run all 4
   generation agents". A real bid streams in token-by-token.
6. **/postmortem** → pick a LOST bid, click "Run postmortem agent".

If a page errors with "Supabase credentials missing", the env vars
either aren't set or the deployment was made before they were added —
trigger a redeploy.

If `/generate` errors at the streaming step with "ANTHROPIC_API_KEY not
configured", same thing.

---

## Step 6 — Custom domain (optional)

Pages dashboard → your project → **Custom domains** → add
`bid-intel.your-domain.com` (or similar). Cloudflare provisions an SSL
cert automatically; DNS verification takes ~30 seconds when the domain
is already on Cloudflare.

---

## Local dev against the same Supabase

```bash
cd web/
cp .dev.vars.example .dev.vars
# Edit .dev.vars with the same values you set in step 3.
npm install
npm run dev
# Open http://localhost:4321
```

`npm run dev` runs the Astro dev server. Server routes (the
`/api/*` Pages Functions) are also served — wrangler handles the
runtime simulation locally.

---

## Cost notes

- Cloudflare Pages free tier: 500 builds/month, 100 deploys/day, 100GB
  bandwidth/month, 100k Functions requests/day. Demo traffic won't
  come close to the limits.
- Supabase free tier: 500 MB DB, 2 GB egress/month. Your seeded data
  is ~5 MB.
- Anthropic: pay-as-you-go. ~$0.10 per generated bid with prompt
  caching enabled (which the SPA does by default).

---

## What's deployed

| Route | What works | Status |
| --- | --- | --- |
| `/` | Landing hero + 5-layer overview | ✅ |
| `/generate` | Bid generation with streaming SSE | ✅ |
| `/bids` | Read-only bid list | ✅ |
| `/jcr` | Reconciliation table + KPIs | ✅ |
| `/postmortem` | Loss postmortem agent | ✅ |
| `/insights` | Intelligence dashboard (read-only) | ✅ |
| `/onboard` | Past-quote upload flow | 🚧 TODO |
| `/compare` | Side-by-side bid compare | 🚧 TODO |
| `/converse` | Ask-about-a-bid chat with compaction beta | 🚧 TODO |

The Streamlit UI in `ui/streamlit_app.py` has the full set if you need
features not yet on the SPA.
