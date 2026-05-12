# Brief — Design Handoff

Source of truth: `Brief Prototype.html` (this project root).
All screen docs link screenshots from `../screenshots/<screen>/<state>.png`.

## How to read this handoff

- Each screen is one markdown file with the eight headed sections you specified:
  `Scope · Mockups · Every state · Interaction behavior · Tokens · Components · Content rules · Accessibility`.
- Mockups are PNGs extracted from the running prototype. **No HTML snapshots** — the prototype is raw CSS + tokens, not Tailwind, so DOM extraction would be noise. Use `class-vocabulary.md` to translate prototype classes → Tailwind utilities.
- Tokens, primitives, and data shapes live in shared docs (linked below) so per-screen docs stay terse.

## Tier order (PR-able independently)

| Tier | What | Why first |
|---|---|---|
| 0 | `tokens.md`, `class-vocabulary.md`, `primitives.md`, `data-shapes.md` | Everything else references these |
| 1 | `onboarding.md`, `quote-production.md`, `quotes-agenda.md` (incl. Reply/Nudge drawer) | Load-bearing for v1 — the "Brief promise" lives here |
| 1b | `quote-detail.md`, `settings.md` | Closes the Tier 1 loop |
| 2 | `jobs.md`, `clients.md`, `dashboard.md` | Operational views — important but not blocking launch |
| 3 | `empty-states.md` | Cross-cutting; pulls cold-start/calibrating/calibrated copy across all five views into one place |

## Route mapping

The prototype is the source of truth; routes map to your existing Astro pages where the function matches.

| Prototype screen | Astro route | Notes |
|---|---|---|
| Quote production | `web/src/pages/generate.astro` | Replaces current `BidGenerator.tsx` island |
| Quotes (Agenda + Table) | `web/src/pages/bids.astro` | Full redesign — kanban view dropped (see `quotes-agenda.md` rationale) |
| Quote detail | `web/src/pages/quotes/[id].astro` | **New route** |
| Jobs | `web/src/pages/jcr.astro` | Full redesign — cost reconciliation table is new |
| Clients | `web/src/pages/clients.astro` | **New route** |
| Dashboard | `web/src/pages/insights.astro` | Full redesign — renamed in nav to "Dashboard" |
| Onboarding (7-step) | `web/src/pages/onboarding.astro` | **New route**, gated by Supabase profile flag |
| Settings | `web/src/pages/settings.astro` | **New route** |

`postmortem.astro` is out of scope for this handoff.

## Global decisions

### SSR vs client islands
- `.astro` pages render server-side via service-role Supabase reads for the initial state.
- Anything interactive is a Solid island. Pattern is established by `BidGenerator.tsx` — keep it.
- **No streaming SSR.** Bundles flush as one chunk. Per the streaming-patch script. SSE from API routes is unrelated and works fine — see Quote production for the canonical client-island consumer.

### SSE pattern (used by Quote production AI scan, Reply/Nudge drafting)
- Client island calls `fetch('/api/...').body.getReader()`, buffers chunks, splits on `\n\n`, JSON-parses each `data:` line, branches on `payload.type`.
- Mirrors `BidGenerator.tsx:82–101`. Reuse, don't reinvent.
- Partial-render contract: the UI must accept `type: 'line_item'`, `type: 'progress'`, `type: 'done'`, `type: 'error'` payloads. Each appends a row or updates state; `done` enables the primary action.

### Fonts
- Prototype uses **Newsreader (serif headers) + Geist (sans) + Geist Mono**.
- You've flagged custom fonts as a build cost. **Two options, you decide once for the whole app:**
  - **(a) Ship the custom fonts** via `@fontsource/newsreader` + `@fontsource/geist-sans` + `@fontsource/geist-mono` — adds ~140KB woff2 across three families, build step minimal. Visual character of the product depends on this.
  - **(b) System-default fallback** — body stays `ui-sans-serif`; serif headers fall back to `ui-serif` (Georgia/Times); mono falls back to `ui-monospace`. The product still works but loses ~30% of its character. The "tool not SaaS" feel comes substantially from Newsreader headers.
- Designs assume **(a)**. If you ship **(b)**, headers will read as Georgia — acceptable but not the intent.

### Content rules (apply globally)
| Thing | Rule |
|---|---|
| Currency | `$1,234.56` (USD, comma thousands, two decimals). Round to nearest cent. |
| Currency, compact (KPIs only) | `$184k`, `$1.2M` (no decimals; `k` lowercase, `M` uppercase) |
| Date, short | `May 12` (no comma, no year unless cross-year) |
| Date, full | `Mon, May 12, 2026` |
| Date, mono ledger | `2026-05-12` |
| Time | `9:10 AM` (12h, no seconds, AM/PM uppercase) |
| Percent | `42%` (no decimal) · `42.3%` only if precision is load-bearing (margin, gross %) |
| Null / missing | em-dash `—` (matches existing convention) |
| File size | binary KB/MB: `1.2 MB`, `340 KB` |
| Age / relative time | `today`, `2d`, `9d` in tabular contexts; `2 days ago` in prose |
| Quote refs | `Q-2026-0042` (zero-padded sequence per year) |
| Job refs | `J-2026-0017` |

### Voice (copy)
- **Brief proposes, the operator decides.** Never auto-sends, never says "I'll handle this."
- Empty states are primary screens, not error screens. Write them as if they were the only screen the user sees.
- Editorial tone in copy surfaces (welcome, empty states, weekly emails). Functional tone in tables and forms.
- See `empty-states.md` for the cold-start / calibrating / calibrated state copy.

### Accessibility (apply globally)
- Focus ring: `outline: 2px solid var(--accent); outline-offset: 2px;` → Tailwind: `focus:outline-2 focus:outline-offset-2 focus:outline-accent-500`. Never remove.
- All icon-only buttons require `aria-label`.
- Status pills carry `aria-label` repeating the state in case the dot/text is ambiguous to AT.
- Color is never the only carrier of state — pills have a leading dot **and** a text label.
- Contrast pairs verified ≥AA at `tokens.md`. Light mode (Paper) tested at AA; Dark mode (Site) tested at AAA on critical pairs.
- Tab order: top-down, left-right within section. Modals trap focus; Esc closes.
- Reply/Nudge slide-over: focus moves to the subject input on open; Esc returns focus to the originating row.

## What's NOT in this handoff (call-outs)

- **Schema migrations** — `data-shapes.md` flags every shape that doesn't fit the current `supabase.ts`. Land migrations first.
- **Postmortem** — out of scope, untouched.
- **Marketing pages** — out of scope. Prerendered routes unaffected.
- **Animation timing** — none load-bearing. The Reply slide-over uses a 180ms slide-in; the AI scan progressively renders line items as SSE events arrive (timing = the model's speed, not a design choice).
