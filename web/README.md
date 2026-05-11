# ProService Bid Intelligence — Web SPA

Custom interactive UI for the project, deployed to Cloudflare Pages with
Pages Functions (serverless) as the backend proxy.

**Status:** Scaffold + minimum viable bid-generation flow. Not yet a full
replacement for the Streamlit UI — see [What's built / what's not](#whats-built--whats-not).

## Stack

| Layer | Tool |
|---|---|
| Framework | [Astro 4](https://astro.build) — multi-page with optional SSR |
| Interactivity | [Solid.js](https://solidjs.com) islands (smaller bundle than React) |
| Styling | [Tailwind CSS](https://tailwindcss.com) |
| Hosting | [Cloudflare Pages](https://pages.cloudflare.com/) (static + SSR) |
| Backend functions | Cloudflare Pages Functions (`/functions/*`) |
| Database | [Supabase Postgres](https://supabase.com) (free tier) |
| LLM | [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) — Claude Sonnet 4.6 + Haiku 4.5 |

## Architecture

```
            ┌───────────────────────────────────────┐
            │  bid-intel.pages.dev (Cloudflare CDN) │
            │  - /              → Hero + landing    │
            │  - /generate      → bid form (SSR)    │
            │  - /bids          → list (SSR)        │
            │  - /insights      → list (SSR)        │
            └──────────────┬────────────────────────┘
                           │ /api/* fetch
            ┌──────────────▼────────────────────────┐
            │  Cloudflare Pages Functions           │
            │  - /api/bids/generate (SSE streaming) │
            │  - /api/bids/[id]                     │
            │  - /api/postmortem                    │
            │  - /api/converse                      │
            └──┬──────────────────────────────┬─────┘
               │                              │
               ▼                              ▼
    ┌─────────────────────┐         ┌──────────────────┐
    │  Anthropic API      │         │  Supabase        │
    │  (server-side key)  │         │  Postgres        │
    └─────────────────────┘         └──────────────────┘
```

The deterministic Pricing math (`src/lib/pricing.ts`) is a TypeScript port of
`agents/pricing.py`. Same behavior contract: every number comes from a
Supabase query, never the LLM. Composition streams via SSE.

## Local dev

Requires Node 20+ and a Supabase project with the bidintel schema
already applied (`db/schema.sql` in the repo root).

```bash
cd web/
npm install

# Configure secrets (do NOT commit .dev.vars)
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your ANTHROPIC_API_KEY, SUPABASE_URL,
# SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY.

# Run dev server — http://localhost:4321
npm run dev
```

Visit `http://localhost:4321/generate` to test the streaming bid flow.

## Deploy to Cloudflare Pages

> Full step-by-step at
> [`docs/deployment/cloudflare-pages-quickstart.md`](../docs/deployment/cloudflare-pages-quickstart.md).
> The summary below assumes you've already deployed to Pages before.

1. Create a Cloudflare Pages project pointing at this repo, **with Root
   directory set to `web`**:
   - <https://dash.cloudflare.com/pages> → Create application → Connect to Git
   - Repository: `GitSteveLozano/BidderProject`
   - Production branch: `main`
   - **Root directory (Advanced): `web`**
   - Build command: `npm install && npm run build`
   - Build output directory: `dist`
   - Environment variable (build): `NODE_VERSION=20`

2. **Settings → Functions** → set:
   - **Compatibility date:** `2026-01-01`
   - **Compatibility flags:** `nodejs_compat` (required for the
     Anthropic SDK + Supabase client)

   Do this for both **Production** and **Preview** environments.

3. **Settings → Environment variables** → add **encrypted** entries for
   the production environment:
   - `ANTHROPIC_API_KEY`
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_KEY`

4. Trigger a deploy. Cloudflare builds and serves at
   `https://<project-name>.pages.dev`. Custom domain: Settings → Custom
   domains.

## What's built / what's not

✅ **Built**
- Landing page (`/`) with the project pitch + 5-layer overview
- Bid generation form (`/generate`) with streaming SSE + Solid.js island
- Pricing pipeline TypeScript port (deterministic math, tool-grounded)
- Composition agent — Anthropic streaming + system-prompt caching
- Exclusions verification (port of the Python heuristic)
- Bids list (`/bids`) — read-only table
- Insights list (`/insights`) — read-only

🚧 **TODO** (Python parity — port from the Streamlit UI)
- Onboarding flow (upload past quotes → run Context agent)
- Loss postmortem page (calls the postmortem agent)
- Compare bids side-by-side
- Ask-about-a-bid chat (compaction beta)
- JCR view (variance analysis, drill-down)
- Capacity forecast chart
- Margin heatmap
- Audit log export
- Follow-up draft + send

The Python FastAPI surface remains the canonical backend. As we port
features, the Cloudflare Functions in `web/functions/api/` re-implement
the equivalent logic in TypeScript so the Cloudflare deployment is fully
self-contained.

## Why a separate frontend?

The Streamlit UI is great for the demo storyboard (spec §8.6) but isn't
shippable as a product:

- Streamlit's session model is one-user-per-process — doesn't scale
- The component library is opinionated; we want bespoke design
- Streamlit Community Cloud is free but has cold starts and a small CPU
- A Cloudflare-hosted SPA can be embedded in customer portals and
  serves at edge latency worldwide

The Streamlit app stays in `ui/streamlit_app.py` as the operator/internal
tool. The Cloudflare SPA is the customer-facing product surface.
