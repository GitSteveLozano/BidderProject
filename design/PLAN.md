# Brief — build plan

Source of truth for the build sequence taking the existing app from "ProService Bid Intelligence" to the Brief redesign delivered in `design/`.

## Decisions locked in

| Decision | Choice |
|---|---|
| Product name | **Brief** (in-app); GitHub repo name unchanged |
| Fonts | (a) Newsreader serif + Geist sans + Geist Mono via `@fontsource/*` |
| Schema migration | Blow-away — fresh `db/migrations/001_brief_schema.sql`; demo data not preserved |
| Sequencing | Schema → tokens+primitives → auth+onboarding+settings → quote production → quotes+detail → jobs+clients+dashboard → polish |
| Scope cuts | None. Build everything in the handoff. |
| Tenancy | Multi-tenant, self-serve onboarding (decided earlier; still holds) |
| Calendar pattern | Google Calendar Pattern A — read-only context + create a "Brief" calendar (per onboarding step 7) |

## What's out of v1 scope

Called out so they don't get pulled in accidentally:

- **Vocab swap (Cavy/Marlon personas)** — the prototype's two-industry vocab system is a demo affordance, not a v1 feature. Hardcode contractor vocab (`quote`, `job`, `crew`). Re-evaluate as a Settings switch once we have product-market traction.
- **`graph` theme** — `styles.css` ships three themes (paper, graph, site); `tokens.md` only specifies paper + site. Skip graph for v1.
- **Density variants** (`compact`, `cozy`, `comfortable`) — designs all use `cozy`. Skip the density toggle for v1.
- **Postmortem agent** — design handoff explicitly omits it. Existing route + endpoints stay in the codebase untouched.
- **`/api/bids/postmortem`** stays as-is.
- **Marketing/index page** — prerendered, unaffected. Update the brand+nav once tokens land; otherwise leave content.

## PR sequence

Seven PRs. Each is independently mergeable except for the noted dependencies. Branch names use `claude/brief-NN-<slug>`.

### PR 1 — schema (`claude/brief-01-schema`)

**What:** Blow-away migration. New `db/migrations/001_brief_schema.sql` matching `design/spec/data-shapes.md`. Drops legacy tables (`companies`, `voice_patterns`, `service_lines`, `bids`, `employees`, `burden_components`, `schedule_allocations`, `intelligence_insights`, etc.) and replaces with: `shops`, `memberships`, `invites`, `clients`, `quotes`, `quote_line_items`, `quote_messages`, `jobs`, `job_cost_lines`, `events`. RLS policies on every tenant table scoped to `auth.uid() → shop_id` via `memberships`. New seed script `db/seed_brief.sql` producing 1 shop + 2 clients + 6 quotes + 2 jobs for demos.

**Files:** `db/migrations/001_brief_schema.sql` (new), `db/seed_brief.sql` (new), `db/schema.sql` (delete or archive — TBD; safer to leave a deprecation note pointing at the migration), README pointer.

**Risks:**
- Python-side code (`agents/`, `tools/`, `api/`) still imports from old tables. Either (a) freeze the Python side and let it break until later cleanup, or (b) drop the old schema *and* delete the Python agents in this PR. I lean (a) — keeps PR 1 reviewable.
- RLS policies are easy to get wrong. Include a test: every policy proved by SQL fixtures that show a different-shop user gets 0 rows.

**Out:** Any UI work. Any auth wiring. Just schema + seed + RLS.

**Size:** Medium (~400 LOC SQL, 2–3 hours).

---

### PR 2 — tokens + primitives + theme (`claude/brief-02-tokens-primitives`)

**Depends on:** PR 1 merged (not strictly — but cleaner if `web/` already knows the new shape exists; not a hard blocker).

**What:**
1. **Fonts:** `npm i @fontsource/newsreader @fontsource/geist-sans @fontsource/geist-mono`; import once from `Base.astro` head.
2. **`tailwind.config.mjs`:** replace `theme.extend` with the block from `tokens.md`. Adds `paper-*`, `site-*`, `accent-*` (sienna), `amber-*` (dark-mode accent), semantic `good/warn/danger/info` with tint+dark variants, custom `text-eyebrow` + `text-kpi`, `rounded-huge`. `darkMode: ['selector', '[data-theme="site"]']`.
3. **`web/src/styles/tokens.css`** (new): CSS-var layer aliasing semantic tokens per `[data-theme]`. Imported once from `Base.astro`.
4. **10 primitives** in `web/src/components/ui/`: `Button.tsx`, `Card.tsx`, `Pill.tsx`, `StatusPill.tsx`, `Field.tsx`, `KpiBlock.tsx`, `DataTable.tsx`, `SlideOver.tsx`, `EmptyState.tsx`, `ProgressiveRender.tsx`, `Stepper.tsx`. Plus the `Sidebar` + `Topbar` chrome in `web/src/layouts/Brief.astro`.
5. **Brand rename:** `web/package.json` name, page titles, Base layout chrome (`ProService Bid Intelligence` → `Brief`). Sidebar shows the "Brief" wordmark + brand mark.
6. **Theme + density attribute** on `<html>` — default `data-theme="paper"`. The toggle UI doesn't ship yet (Settings is later); just the markup.
7. **Existing pages keep rendering** through this PR — they'll re-skin to the new palette+fonts automatically because they use the same Tailwind classes. The redesigns happen in later PRs.

**Files:** `web/tailwind.config.mjs`, `web/src/styles/tokens.css`, `web/src/components/ui/*.tsx` (10 new), `web/src/layouts/Base.astro` (rebranded → rename to `Brief.astro` and update imports), `web/package.json`.

**Risks:**
- Existing pages (`/bids`, `/jcr` etc.) will look different the moment this merges. Acceptable for an in-progress redesign branch; warn user before merging.
- Font weights / variable axes — Newsreader is variable; pick weights at 400, 500, 600. Geist Sans likewise.

**Size:** Medium-large (10 primitives + theme system, 5–7 hours).

---

### PR 3 — auth + onboarding + settings (`claude/brief-03-auth-onboarding`)

**Depends on:** PRs 1 + 2.

**What:**
1. **Supabase Auth** wired up with Google OAuth provider. Callback handler at `/auth/callback`. Session cookie config tuned for Cloudflare Pages (SameSite, Secure, domain).
2. **Onboarding** at `/onboarding`, 7-step. New route. Gated by `shops.data_state === 'cold-start' && !onboarding_completed_at`. Includes Google sign-in (step 1), voice upload (step 2 — uses Supabase Storage + `/api/voice/analyze` SSE endpoint stub returning hand-rolled events for now), license lookup (step 3 — `/api/license/lookup` stubbed for CSLB only), profile review (step 4–5), defaults (step 6), Calendar Pattern A consent (step 7 — `POST /api/integrations/google-calendar/connect`).
3. **Self-serve company creation:** first sign-in without an invite token creates a `shops` row + `memberships` row with `role='owner'`. Invite token flow boilerplate; full invite UI ships with Settings.
4. **Auth middleware/guard:** every SSR page checks for a session; unauthenticated redirects to `/auth/signin`. `/`, `/auth/*`, `/onboarding/welcome` stay public.
5. **Settings** at `/settings`, sections: Account, Shop & license, Pricing defaults, Connected services, Branding, Notifications, Data export. Integration connect/disconnect flows (Google Calendar, ProService API key, QuickBooks/DocuSign/Drive OAuth stubs).
6. **Sidebar shop selector** wired to `memberships` (one shop in v1; UI accommodates multi).

**Files:** `web/src/pages/auth/signin.astro`, `web/src/pages/auth/callback.astro`, `web/src/pages/onboarding.astro` + step islands, `web/src/pages/settings.astro` + section islands, `web/src/middleware.ts` (new — auth gate, set per-request `session` on `Astro.locals`), `web/src/lib/auth.ts`, `web/src/lib/google-calendar.ts`, `web/src/pages/api/voice/analyze.ts`, `web/src/pages/api/license/lookup.ts`, `web/src/pages/api/integrations/google-calendar/connect.ts`, `web/src/pages/api/integrations/google-calendar/disconnect.ts`.

**Risks:**
- **Middleware reverted last time** for breaking SSR (`9efe16d`). Re-introduce carefully — only run on `Astro.url.pathname.startsWith('/...')` and don't clone the response. Test against the prior failure mode.
- **Google Cloud verification** for sensitive scopes (Calendar `https://www.googleapis.com/auth/calendar`) takes weeks. Start the paperwork the day this PR opens.
- **Token refresh** — Google access tokens expire in 1hr. Store `refresh_token` on `shops`; refresh server-side per request. Per-shop, not per-user, in v1 (single owner).
- **Voice analysis endpoint** can't fully ship until we wire Claude tool-use; v1 returns plausible fake events via SSE so the UX exists. Real Claude integration in PR 4.

**Size:** Large (auth + 2 new routes + 5 new endpoints, 1–2 days).

---

### PR 4 — quote production (`/generate`) (`claude/brief-04-quote-production`)

**Depends on:** PRs 1 + 2 + 3.

**What:**
1. **Full redesign of `/generate`** as a 5-step Solid island flow: Intake → Scope → Pricing → Review → Send. Replaces current `BidGenerator.tsx`.
2. **Intake step:** 4 method cards (PDF, voice, type, site-visit). PDF upload → Supabase Storage → `quote_artifacts` row.
3. **Scope step uses real SSE.** `POST /api/quote/scan` returns `text/event-stream` with events: `{type: 'progress'}`, `{type: 'line_item'}`, `{type: 'flag'}`, `{type: 'done'}`, `{type: 'error'}`. Each `line_item` carries `description, qty, unit, unit_price, subtotal, category, confidence, source_excerpt`. Uses Claude tool-use streaming under the hood — one tool call per line item.
4. **Pricing step:** client-side computed margin via Solid signals; line-items table with inline editing, markup, total, margin readout. No network until step 5.
5. **Review step:** `POST /api/quote/render-pdf` returns a PDF blob URL; iframe preview pane.
6. **Send step:** `POST /api/quote/send` — DocuSign if connected else email via `/api/email/send`. State machine: `DRAFT → SENT`.

**Files:** `web/src/pages/generate.astro` (full rewrite), `web/src/components/quote-production/*.tsx` (Intake, Scope, Pricing, Review, Send + sub-components), `web/src/pages/api/quote/scan.ts`, `web/src/pages/api/quote/render-pdf.ts`, `web/src/pages/api/quote/send.ts`, `web/src/lib/pdf.ts`.

**Risks:**
- **Streaming SSR is off** — make sure the page shell renders fully before any client work. Step-1 cards must be in the SSR'd HTML.
- **SSE reconnection** — if the connection drops mid-stream, the client picks up where it stopped (per `empty-states.md`). Server must accept a `resume_from_idx` parameter.
- **PDF rendering on Cloudflare Workers** — no `puppeteer`. Options: (a) Cloudflare Browser Rendering (paid, new); (b) `@react-pdf/renderer` (works in Workers, less faithful); (c) `pdf-lib` (lowest-level, most work). Decision deferred to this PR's planning.
- **Claude tool-use cost per quote** — streaming line items multiplies per-call cost. Cache the scope-doc analysis; only re-stream on changes.

**Size:** Large (5-step flow + 3 API routes + PDF, 2 days).

---

### PR 5 — quotes (agenda + table) + quote detail (`claude/brief-05-quotes-detail`)

**Depends on:** PRs 1 + 2 + 3.

**What:**
1. **`/bids` full redesign:** default Agenda view (chronological action groups: Today / This week / Cooling off / Later / Decided), with a Table view tab. Pipeline value strip across the top. Drops the previous kanban.
2. **Reply/Nudge slide-over drawers.** Open from any row's action button. Both use SSE — `POST /api/quote/draft-reply` and `POST /api/quote/draft-nudge` stream the draft body line-by-line. First user keystroke aborts the stream. "Best time to send" chip computed server-side from Google Calendar busy times.
3. **Quote messages thread** persisted in `quote_messages` (from PR 1 schema).
4. **New route `/quotes/[id]`:** quote detail. Header (client, ref, state pill, total) + line items table + sidebar (activity feed + files). Inline line-item edit (Solid island). Clone-to-new-quote.
5. **`<ActivityFeed />`** primitive (vertical `<ol>` of typed events with relative timestamps).

**Files:** `web/src/pages/bids.astro` (full rewrite — rename to `quotes.astro`? screens.md keeps `/bids`; verify intent — defaulting to renaming since "Quotes" is the brand label), `web/src/components/quotes/*.tsx` (AgendaGroup, AgendaRow, PipelineStrip, ReplyDrawer, NudgeDrawer), `web/src/pages/quotes/[id].astro` (new), `web/src/components/quotes/QuoteDetail.tsx`, `web/src/pages/api/quote/draft-reply.ts`, `web/src/pages/api/quote/draft-nudge.ts`, `web/src/pages/api/quote/message.ts`, `web/src/pages/api/quote/best-send-time.ts`.

**Open question for user:** rename route from `/bids` to `/quotes`? Designs say "Quotes" everywhere in copy. Mechanically the route name is independent of the label; keeping `/bids` is fine. Recommending rename for consistency with the rest of the URL space (`/quotes/[id]`).

**Risks:**
- **Calendar API rate limits** — `best-send-time` for every drawer-open is hot. Cache per-user free/busy for 60s.
- **Stream-abort UX** — Solid signals + AbortController need careful wiring; the prototype mocks this.

**Size:** Large (2 redesigned views + new detail route + 2 SSE drafters, 2 days).

---

### PR 6 — jobs + clients + dashboard (`claude/brief-06-jobs-clients-dashboard`)

**Depends on:** PRs 1 + 2 + 3.

**What:**
1. **`/jcr` full redesign as `/jobs`:** split layout (list left, detail right). `<CostReconciliation />` table — variance colors per `tokens.md`. Manual cost entry inline. ProService payroll sync banner (just status display in v1; cron lands later).
2. **New `/clients` route:** sortable client table, detail right-rail, auto-create flow (clients auto-add when quotes are sent — covered by PR 4 schema usage).
3. **`/insights` full redesign as `/dashboard`:** KPI tiles (`<MetricCard />`), `<PipelineFunnel />` SVG, `<CapacityGauge />`, last-10-events feed. Click-through navigation to filtered list views. Per `empty-states.md`: cold-start, calibrating, calibrated treatments.

**Files:** `web/src/pages/jobs.astro` (new route name; `web/src/pages/jcr.astro` archived/redirected), `web/src/components/jobs/CostReconciliation.tsx`, `web/src/pages/clients.astro` + island, `web/src/pages/dashboard.astro` (renamed from `insights.astro`), `web/src/components/dashboard/{PipelineFunnel,CapacityGauge,ActivityPolling}.tsx`.

**Open question for user:** rename `/jcr` → `/jobs`, `/insights` → `/dashboard`? Designs use Jobs/Dashboard labels; URLs follow. Same logic as `/bids` → `/quotes`.

**Risks:**
- **Polling vs WebSocket** on dashboard activity — designs say polling at 60s. Fine.
- **Charts** — SVG only, no chart lib. Funnel + gauge are simple enough.

**Size:** Medium-large (3 redesigned views + a chart component, 1–2 days).

---

### PR 7 — polish + empty-state copy sweep (`claude/brief-07-polish`)

**Depends on:** PRs 1–6.

**What:**
1. **Empty-state copy audit** — every screen's cold-start / calibrating / calibrated / quiet / error string lifted from `empty-states.md`. Includes the sidebar calibration pill and tooltip.
2. **`data_state` derivation:** either compute on read or materialize on write. Materialize is simpler — recompute on quote count change via DB trigger.
3. **Theme toggle** in Settings → Account (paper/site).
4. **A11y sweep:** every icon-only button has `aria-label`; status pills have `aria-label`; SSE-driven surfaces have `aria-live="polite"` regions; modal/drawer focus traps verified.
5. **Mobile breakpoints** validated against `mockups/mobile-*.png`. Sidebar collapses to bottom tab bar < 880px (per `styles.css` media query).
6. **Per-page `no-store` headers** confirmed on every SSR page (carried over from current `bids.astro` pattern).
7. **The `/bids?diag=1` probe** stays as a permanent regression tripwire (`x-ssr-build-tag` header). Update its tag value to reflect the new build identity.

**Files:** Spot edits across the redesigned pages; one new DB function/trigger for `data_state`; toggle UI in Settings.

**Size:** Medium (polish across the surface, 1 day).

---

## Cross-cutting / what NOT to forget

- **Adapter patch (`scripts/patch-cf-streaming.mjs`)** stays as-is. Every PR's build will continue running it post-`astro build`. Don't remove unless `@astrojs/cloudflare` ships a `streaming: false` option.
- **`web/src/pages/postmortem.astro`** is explicitly out of scope. Leave it alone. Sidebar nav drops the "Postmortem" link entirely.
- **Existing Python `agents/`, `tools/`, `api/` directories** — not touched in any of these PRs. They're orphan code after PR 1 lands the new schema. Either delete in a follow-on cleanup PR or leave for a v2 cleanup.
- **The `/api/health` endpoint** keeps working — update it to check the new tables instead of old ones in PR 1.
- **Existing `/api/bids/postmortem`** stays. Maps to the legacy data, which won't exist post-PR-1, so this endpoint will silently 404 against the new schema. Acceptable since postmortem is out of scope.
- **Custom domain / Cloudflare Pages settings** unchanged.
- **`web/src/components/BidGenerator.tsx`** and **`PostmortemRunner.tsx`** — `BidGenerator` is deleted by PR 4 (replaced by 5-step islands); `PostmortemRunner` stays untouched.

## Open questions for user

1. **Route renames** — rename `/bids`→`/quotes`, `/jcr`→`/jobs`, `/insights`→`/dashboard` to match design copy? Recommending yes. Confirms naming consistency across the codebase but each rename is a redirect entry. (PRs 5 + 6)
2. **PDF rendering approach** for `/api/quote/render-pdf` — Cloudflare Browser Rendering (paid, faithful), `@react-pdf/renderer` (free, less faithful), or `pdf-lib` (lowest-level)? (PR 4)
3. **Python `agents/`** — delete in PR 1 alongside the schema swap, or leave as orphaned code until a v2 cleanup pass? I lean leave until we're sure nothing's salvageable.
4. **Google Cloud OAuth verification** — who's filing the Calendar scope verification with Google? It can run in parallel to the build; the app works in test-mode with up to 100 users in the meantime. (PR 3)
5. **Real-vs-stub** — the voice-analyze endpoint in PR 3 ships with mocked SSE events to make the UX exist. Real Claude integration follows in a small follow-on. Confirm.

## Estimated total

~10–14 working days, 7 PRs. PR 1, 2, 7 are smaller; PR 3, 4, 5 are the big lifts.
