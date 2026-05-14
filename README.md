# Brief

Bid production and pipeline operations for contractors.

> Brief proposes; you decide.

A specialty contractor's workday isn't email or spreadsheets — it's standing in a project, talking through a scope, then writing a quote that night that has to be right or you lose the next three. Brief produces those quotes in ten minutes instead of three hours, tracks them through reply/nudge/win/loss, reconciles delivered margin against quoted margin, and shows you the patterns once enough jobs have closed.

## Status

**In active redesign.** The current `main` is the first cut after merging the design handoff (`design/`). The 7-PR sequence in `design/PLAN.md` builds the productized Brief experience on top of the existing Cloudflare Pages + Astro + Supabase stack.

What's in the tree right now:

- `web/` — Astro 4 hybrid SSR app, deployed on Cloudflare Pages. SSR pages render server-side via Supabase service-role reads (will switch to authed RLS in PR 3).
- `db/migrations/001_brief_schema.sql` — fresh multi-tenant schema with RLS. Drop and re-apply against a fresh Supabase project.
- `db/seed_brief.sql` — one demo shop (L·A Stucco, Cavy) + 4 clients + 6 quotes + 2 jobs.
- `design/` — design handoff: specs, mockups, primitives, port notes from the prior Python agents, full build plan in `PLAN.md`.

What's deleted (lived under `main` before this PR — see `design/agent-port-notes.md` for the surviving math + prompts):

- `agents/`, `tools/`, `api/` — Python multi-agent backend (FastAPI + Celery + pgvector). Architecture continues; runtime is now TypeScript inside `web/`.
- `cli.py`, `streamlit_app.py`, `tests/`, the Python `db/seed*.py` family, `Dockerfile`, `docker-compose.yml`, `pyproject.toml`, `requirements.txt` — Python infra.

The 8-agent / 5-layer architecture is preserved conceptually: intake parses the scope into structured line items; context loads the shop's voice profile; pricing does deterministic math over real loaded labor + materials; composition writes the bid in the shop's voice; follow-up runs segment-aware cadence; JCR reconciles quoted vs delivered cost; intelligence surfaces operating patterns once `n ≥ 15` bids. They now live as Astro API routes + Claude tool-use streams.

## Stack

- **Astro 4.16 hybrid** on Cloudflare Pages — SSR `.astro` pages + prerendered marketing
- **Solid JS** for interactive islands (existing pattern: `web/src/components/BidGenerator.tsx`)
- **Tailwind 3.4** with the Brief palette (Paper light / Site dark — see `design/spec/tokens.md`)
- **Supabase** as the backing store + auth (Google OAuth via Supabase Auth) + storage (voice samples, quote artifacts)
- **Anthropic SDK** for everything LLM — Sonnet for synthesis (composition, intelligence narratives), Haiku for routing/extraction
- **`@react-pdf/renderer`** for client-deliverable bid PDFs (added in PR 4)

## Quickstart (local development)

```bash
cd web
npm install
echo 'SUPABASE_URL="https://<project>.supabase.co"'      > .dev.vars
echo 'SUPABASE_ANON_KEY="..."'                          >> .dev.vars
echo 'SUPABASE_SERVICE_KEY="..."'                       >> .dev.vars
echo 'ANTHROPIC_API_KEY="sk-ant-..."'                   >> .dev.vars
npm run dev      # astro dev — Vite-fast iteration
# OR
npm run preview  # wrangler pages dev — closest to production
```

Open <http://localhost:4321>. `/api/health` confirms the env + Supabase project + table list.

### Apply the schema

Against a fresh Supabase project (or one where the legacy `bidintel` tables have been dropped):

```bash
psql "$SUPABASE_DB_URL" -f db/migrations/001_brief_schema.sql
psql "$SUPABASE_DB_URL" -f db/seed_brief.sql
```

`SUPABASE_DB_URL` is the direct-connection string from Supabase → Project Settings → Database → Connection string (URI). Use `service_role` for the migration and seed — RLS policies are bypassed.

To wire your Google sign-in to the demo shop after first sign-in:

```sql
INSERT INTO memberships (user_id, shop_id, role)
VALUES (
  (SELECT id FROM auth.users WHERE email = 'you@example.com'),
  '00000000-0000-4000-8000-000000000001',
  'owner'
);
```

## Deploy

Cloudflare Pages auto-builds from `main`. Required compatibility flags on the Pages project:

- **Compatibility date:** 2025-07-18 or later
- **Compatibility flags:** `nodejs_compat`

A postbuild script (`web/scripts/patch-cf-streaming.mjs`) patches the Astro Cloudflare adapter to disable streaming SSR — required because `nodejs_compat` confuses Astro's Node detection and breaks streaming HTML responses (we previously shipped `[object Object]` bodies before catching this; see commit history if it ever regresses).

The `/quotes?diag=1` (formerly `/bids?diag=1`) endpoint stamps an `x-ssr-build-tag` header on every response and exposes the runtime detection booleans as JSON. Permanent regression probe.

## Repo layout

```
web/                          Astro app (production code)
  src/pages/                  routes (SSR + prerendered)
  src/components/             Solid islands + Astro components
  src/lib/                    shared TS (supabase client, pricing, …)
  scripts/patch-cf-streaming  postbuild adapter patch
db/
  migrations/                 versioned SQL — apply in order
  seed_brief.sql              demo data
design/
  PLAN.md                     the 7-PR build sequence
  spec/                       screen specs, primitives, tokens, data shapes
  snapshots/                  prototype JSX + HTML reference
  mockups/                    PNG mockups per breakpoint
  agent-port-notes.md         distilled prompts/math from the deleted Python tree
.github/workflows/ci.yml      lint + typecheck + build on push
```

## Decisions

Living in `design/PLAN.md`. Highlights:

- Multi-tenant from day one (`shops` + `memberships` + RLS).
- Self-serve onboarding — first Google sign-in creates a shop.
- Astro streaming SSR is permanently disabled (Cloudflare runtime incompat). SSE from API routes works fine; `BidGenerator.tsx` is the reference consumer.
- Newsreader serif + Geist sans/mono ship via `@fontsource/*`.
- Bid PDFs render via `@react-pdf/renderer` (declarative, ~250 LOC for a multi-page bid; custom font embedding).

## License

Proprietary.
