# Screens

One section per screen with the eight required headings. Per the spec, bundling into one file is fine — keeps cross-references tight. Screenshots live in `../screenshots/<screen>/<state>.png`.

---

## 1. Onboarding

### Scope
**New route.** `web/src/pages/onboarding.astro` (+ child islands). Gated by `shops.data_state === 'cold-start' && !onboarding_completed_at`. After step 7, redirects to `/generate`.

7 linear steps with `<Stepper />`. Step 2 (voice upload) is the load-bearing trust moment — the operator uploads a recent quote/proposal/email; Brief extracts voice, vocabulary, formatting. Without it, the rest of Brief reads as generic.

### Mockups
- `screenshots/onboarding/01-welcome.png` — Google sign-in surface
- `screenshots/onboarding/02-voice-upload.png` — drop zone, accepted types, "why we ask"
- `screenshots/onboarding/02-voice-uploading.png` — progress + extracted-voice preview streaming in
- `screenshots/onboarding/03-license.png` — CSLB / DCCA / other; jurisdiction picker
- `screenshots/onboarding/04-scan.png` — Brief shows what it learned, editable
- `screenshots/onboarding/05-confirm.png` — profile summary, edit-in-place
- `screenshots/onboarding/06-defaults.png` — markup %, labor rate, terms
- `screenshots/onboarding/07-calendar.png` — Pattern A consent (read-only context, Brief calendar created)
- `screenshots/onboarding/mobile-02.png` — voice upload, mobile
- `screenshots/onboarding/mobile-07.png` — calendar consent, mobile

### Every state
- **Default** — step 1 / 7 visible, primary CTA: "Continue with Google".
- **Loading** — between steps, brief progress bar; no full-page spinner.
- **Empty** — n/a (this is itself the empty state of the app).
- **Error** — Google OAuth fail: inline error above the button, "Try again". Voice upload parse fail: keep the upload, show "We couldn't read this one — try a recent quote or email instead." Never block; offer "Skip for now (you'll have less polish)".
- **Hover/focus** — standard focus ring on all controls; drop zone shows accent border on dragenter.
- **Disabled** — Continue disabled until step requirements met. Disabled state shows reason as muted helper text.
- **Success** — final step 7 has a "You're set" confirmation that holds for ~1s before redirect.

### Interaction behavior
- **SSR**: page shell is `.astro`. Step components are Solid islands so state survives client-side step navigation.
- **Network**:
  - Step 1 → Google OAuth (Supabase auth).
  - Step 2 → uploads to Supabase Storage (`shops/<id>/voice/`), then POSTs to `/api/voice/analyze` which **streams via SSE** (line items: vocabulary findings, tone signals, formatting conventions). UI progressively renders findings in a sidecar panel.
  - Step 3 → optional CSLB lookup at `/api/license/lookup?jurisdiction=CA&number=...`. Pre-fills name/class/expiry if matched.
  - Step 4 → no network; user reviews & edits.
  - Step 5 → `PATCH /api/shops/me`.
  - Step 6 → `PATCH /api/shops/me/defaults`.
  - Step 7 → Google Calendar OAuth scope grant; on accept, `POST /api/integrations/google-calendar/connect` creates the "Brief" calendar.

### Tokens
None new. Uses `paper` palette by default; user can switch to `site` from Settings later.

### Components
- New: `<Stepper />` (horizontal, 7 dots)
- New: `<VoiceUploadCard />` (drop zone + analysis sidecar) — local to onboarding
- Reused: `<Button />`, `<Card />`, `<Field />`

### Content rules
- License number: render exactly as entered, no auto-format.
- Markup %: integer or one decimal, e.g. `22%`, `18.5%`.
- Voice sample size limit: 10 MB; accepted types `.pdf, .docx, .txt, .eml, .md`.

### Accessibility
- Stepper has `aria-current="step"` on the active dot.
- Drop zone: `role="button"` + visible Browse fallback; keyboard-accessible.
- Errors announced via `aria-live="polite"` region under each step.
- Tab order: Stepper → step content → secondary action → primary action.

---

## 2. Quote production (`/generate`)

### Scope
**Full redesign** of `web/src/pages/generate.astro` + `web/src/components/BidGenerator.tsx`. The 10-minute flow: intake → AI scan → scope confirm → pricing → review → sent. Replaces the current single-form BidGenerator.

### Mockups
- `screenshots/quote-production/01-intake.png` — upload / voice memo / type / from-site-visit
- `screenshots/quote-production/02-scan-streaming.png` — SSE rendering line items as they're identified
- `screenshots/quote-production/02-scan-done.png` — all items in, confidence chips, source excerpts
- `screenshots/quote-production/03-scope.png` — Brief proposes scope; user edits
- `screenshots/quote-production/04-pricing.png` — line items, markup, total; margin readout
- `screenshots/quote-production/05-review.png` — PDF preview pane + cover letter
- `screenshots/quote-production/06-sent.png` — sent confirmation + next-step proposals
- `screenshots/quote-production/mobile-04.png` — pricing on mobile

### Every state
- **Default (step 1)** — four intake methods as equal-weight cards: Upload, Voice, Type, From site visit.
- **Loading** — SSE stream renders progressively; **no spinner**, items just appear.
- **Empty** — step 4 with no line items extracted: "I couldn't pull anything firm from this. Want to dictate it instead?" + offers Voice intake re-entry.
- **Error** — SSE connection drops: inline banner, "Connection interrupted at item 7 — Brief picked up where it stopped." Auto-retry once before showing manual Retry button. Per-line item parse errors: highlight the row, "couldn't compute" badge, manual entry inline.
- **Hover/focus** — line item rows highlight on hover; source-excerpt button reveals popover.
- **Disabled** — "Send quote" disabled until step 5 (review) is reached and all required fields are filled.
- **Success** — step 6 with confetti-less confirmation: "Quote sent to Diane. I'll let you know when she opens it."

### Interaction behavior
- `.astro` page renders shell + step 1. Solid island takes over from step 2.
- **SSE — load-bearing.** Step 2 calls `POST /api/quote/scan` with the uploaded artifact id. Endpoint returns `text/event-stream` with payloads: `{type: 'line_item', payload: {...}}`, `{type: 'progress', payload: {percent}}`, `{type: 'done'}`, `{type: 'error'}`. Client reads via `body.getReader()` — pattern is `BidGenerator.tsx:82–101`.
- Step 3 → POST scope edits via debounced autosave (1.5s after last keypress).
- Step 4 → pricing recompute is **fully client-side** (Solid signal-driven). No network until step 5 save.
- Step 5 → `POST /api/quote/render-pdf` returns a PDF blob URL; preview iframes it.
- Step 6 (Send) → `POST /api/quote/send` — uses DocuSign if connected, else attaches PDF to email via `/api/email/send`.

### Tokens
None new. Confidence chips reuse the pill scale: `high → good`, `med → info`, `low → warn`, `manual → muted`.

### Components
- New: `<IntakeMethodCard />` — step 1 cards
- New: `<LineItemRow />` (with confidence chip + source-excerpt popover) — also reused in `<CostReconciliation />`
- New: `<PricingPanel />` — step 4 right-rail margin readout
- Reused: `<Stepper />`, `<Button />`, `<Card />`, `<Field />`, `<ProgressiveRender />`

### Content rules
- Line item subtotals: `$1,234.56`.
- Margin %: one decimal, `22.4%`.
- Confidence chips: text "high" / "med" / "low" / "manual"; tooltip explains.
- Source excerpts: 80-char truncation in popover; click expands.

### Accessibility
- SSE updates announced via `aria-live="polite"` on a screen-reader-only region (`"Added: 240 sqft sand-float finish, $1,440"`).
- Confidence chips have `aria-label="Confidence: medium"`.
- Step 5 PDF preview: alt text "Quote preview, page 1 of N"; keyboard-arrow scrubs pages.
- Tab order across steps: stepper → main content → sidecar → primary action.

---

## 3. Quotes (Agenda + Table) (`/bids`)

### Scope
**Full redesign** of `web/src/pages/bids.astro`. Default view is **Agenda** (chronological, action-oriented), with **Table** as a secondary tab for power use. The kanban view in the previous design is dropped — see `README.md` for rationale.

### Mockups
- `screenshots/quotes-agenda/01-agenda-default.png` — populated, all groups
- `screenshots/quotes-agenda/02-pipeline-strip.png` — close-up of the value-by-stage strip
- `screenshots/quotes-agenda/03-table.png` — Table view, sortable
- `screenshots/quotes-agenda/04-reply-drawer.png` — Reply slide-over open, draft visible
- `screenshots/quotes-agenda/05-nudge-drawer.png` — Nudge slide-over, "best time to send" chip
- `screenshots/quotes-agenda/06-empty-cold-start.png` — no quotes yet
- `screenshots/quotes-agenda/07-empty-quiet.png` — all groups empty mid-day ("Nothing here. Quiet is good.")
- `screenshots/quotes-agenda/mobile-agenda.png` — agenda, mobile (stacked rows)
- `screenshots/quotes-agenda/mobile-drawer.png` — Reply drawer takes full screen on mobile

### Every state
- **Default** — agenda groups: Today, This week, Cooling off (>14d), Later, Decided (collapsed).
- **Loading** — skeleton rows in each group; pipeline strip shows muted bars.
- **Empty (cold-start)** — primary empty state with copy "No quotes yet. The fastest way to start is to upload one you sent recently." + primary CTA → `/generate`. See `empty-states.md`.
- **Empty (quiet)** — populated app but no Today/This-week items: "Nothing here. Quiet is good." in serif italic.
- **Error** — Supabase read fails: inline banner at top, table renders with stale cache if available, "Couldn't refresh — try again" button.
- **Hover/focus** — row hover lightens bg; action button shows on hover, but is always reachable via keyboard.
- **Disabled** — Decided group's action area is replaced with the won/lost summary.
- **Success** — after Reply or Nudge sent: row updates state (Responded → no longer in Today), brief inline toast "Reply sent to Diane".

### Interaction behavior
- `.astro` reads quotes server-side via service-role (RLS-aware via session JWT).
- View toggle (Agenda ↔ Table) is client-only, no re-fetch.
- Reply/Nudge action opens `<SlideOver />` (Solid island).
- **Reply drawer SSE**: opens immediately with a placeholder, then `POST /api/quote/draft-reply` streams the body via SSE — line-by-line render in the textarea (user can start editing before completion). On the first user keystroke, abort the stream.
- **Nudge drawer SSE**: same pattern, `POST /api/quote/draft-nudge`.
- Send: `POST /api/quote/message` with `{quoteId, channel, subject, body, scheduledFor}`.
- "Best time to send" chip is computed server-side from Google Calendar busy times + recipient email open patterns (lightweight). Refreshes when drawer opens.

### Tokens
None new.

### Components
- Reused: `<DataTable />`, `<StatusPill />`, `<Button />`, `<SlideOver />`, `<EmptyState />`, `<ProgressiveRender />`
- New: `<AgendaGroup />`, `<AgendaRow />`, `<PipelineStrip />` (60px stacked-bar)

### Content rules
- Age: `today`, `2d`, `9d` (mono).
- Group counts: integer in mono.
- "Best time to send" chip: `Send now`, `Send 9 AM tomorrow`, `Send Tue 9 AM`.
- Decided summary: "12 won · 4 lost" (no decimals).

### Accessibility
- Agenda groups: `role="region"` with `aria-labelledby` pointing to the group header.
- Pipeline strip: each segment has `aria-label="Awaiting: 4 quotes, $32k"`.
- SlideOver: focus traps; Esc closes; focus returns to triggering row.
- The "send-time chip" is decorative — same info should be in the drawer's reasoning copy for AT.

---

## 4. Quote detail (`/quotes/[id]`)

### Scope
**New route.** Single quote — header, line items, activity timeline, message thread, files. Opened from any agenda/table row click.

### Mockups
- `screenshots/quote-detail/01-default.png` — header, line items, sidebar with activity
- `screenshots/quote-detail/02-edit-line-item.png` — inline edit modal
- `screenshots/quote-detail/03-activity-feed.png` — opened, viewed, replied events
- `screenshots/quote-detail/mobile.png` — stacked layout

### Every state
- **Default** — header (client, ref, state pill, total), line items table, sidebar (activity + files).
- **Loading** — skeleton header + skeleton table + skeleton activity feed.
- **Empty (no activity yet)** — sidebar shows "Sent to Diane — no opens yet. Brief will let you know."
- **Error** — 404 if quote not in current shop: redirect to `/bids` with toast. 500: full-page error state with "Reload" + a link back to `/bids`.
- **Hover/focus** — table row hover; activity feed events hoverable to show timestamp.
- **Disabled** — edit controls disabled if state is `WON` or `LOST` (immutable post-decision). Show "Decided — clone to edit" instead.
- **Success** — toast on save; activity feed appends a new "Edited" event.

### Interaction behavior
- `.astro` SSR reads the quote + line items + last 50 events + last 20 messages.
- Edit line item: opens an inline form (Solid island), `PATCH /api/quote/line-item/:id`. Optimistic update with rollback on error.
- "Send reminder" button opens the Reply/Nudge drawer (same primitive as `/bids`).
- "Clone" creates a new draft and redirects to `/generate?from=<id>` (step 3, scope, pre-filled).

### Tokens
None new.

### Components
- Reused: `<StatusPill />`, `<Card />`, `<Button />`, `<DataTable />`, `<SlideOver />`
- New: `<ActivityFeed />` — vertical list of typed events with relative timestamps

### Content rules
- Header total: `$184,200.00` (full precision).
- Activity timestamps: relative (`3h ago`) with absolute on hover tooltip.

### Accessibility
- Header is `<h1>` with the ref + client; status pill carries aria-label.
- Activity feed is `<ol>`; each event is `<li>` with timestamp in `<time datetime="...">`.
- Inline edit form: standard form a11y; Esc cancels.

---

## 5. Jobs (`/jcr`)

### Scope
**Full redesign** of `web/src/pages/jcr.astro`. Two views: list (left) + detail (right). Detail features the **cost reconciliation** table — the differentiating value of Brief for finishing jobs.

### Mockups
- `screenshots/jobs/01-list-detail.png` — split layout, list left, detail right
- `screenshots/jobs/02-cost-recon.png` — full reconciliation table
- `screenshots/jobs/03-variance-warning.png` — variance > 20% over
- `screenshots/jobs/04-empty.png` — no jobs yet
- `screenshots/jobs/mobile-list.png` — list only
- `screenshots/jobs/mobile-detail.png` — full-screen detail with back button

### Every state
- **Default** — populated split view, first job auto-selected.
- **Loading** — list skeleton; detail shows centered spinner with text "Loading job".
- **Empty (cold-start)** — "Jobs show up here when you mark a quote won. Won one already? Mark it from /bids." + CTA to `/bids?state=won`.
- **Empty (no won quotes)** — "Win your first quote and I'll start tracking the job here."
- **Error** — Payroll sync failure: yellow banner in detail "Payroll hasn't synced since 2d ago. Showing manual entries only." Manual entry remains usable.
- **Hover/focus** — list items hover; reconciliation rows hover.
- **Disabled** — "Close job" disabled until variance reconciliation has at least one actual on every category.
- **Success** — saving an actual: row pulses accent for 200ms, totals recompute.

### Interaction behavior
- `.astro` reads jobs + cost lines server-side. Detail uses a Solid island for editing.
- Manual cost entry: inline editable cell, `PATCH /api/job/cost-line/:id`.
- Payroll sync is a periodic Cloudflare cron (not a UI action) — UI just shows `payroll_synced_at`.
- "Close job" → `POST /api/job/:id/close` (state machine guard server-side).

### Tokens
None new. Variance colors: `text-good` (under), `text-ink` (within ±5%), `text-warn` (5-20% over), `text-danger` (>20% over).

### Components
- New: `<CostReconciliation />` — see `primitives.md`
- Reused: `<DataTable />` (jobs list), `<StatusPill />`, `<Card />`, `<Button />`

### Content rules
- Variance amounts: signed, `+$1,240.00` / `−$340.00` (Unicode minus).
- Variance %: signed, one decimal, `+12.4%`.
- Closed-job totals: bold.

### Accessibility
- Split view: list is `<nav aria-label="Jobs">`, detail is `<main>`.
- Variance cells: `aria-label="Over by 12.4 percent"` (text-only screen readers don't see the color).

---

## 6. Clients (`/clients`)

### Scope
**New route.** Searchable table of clients with detail panel.

### Mockups
- `screenshots/clients/01-table.png` — sortable table
- `screenshots/clients/02-detail.png` — client detail (right rail or full page)
- `screenshots/clients/03-empty.png` — no clients yet
- `screenshots/clients/mobile.png` — table collapsed to cards

### Every state
- **Default** — table sorted by `last_activity_at` desc.
- **Loading** — skeleton rows.
- **Empty (cold-start)** — "Clients are added automatically as you quote. The first quote you send creates the first client." + CTA → `/generate`.
- **Error** — standard table error pattern.
- **Hover/focus** — row hover; detail link.
- **Disabled** — delete client disabled if any quotes reference it (show why on hover).
- **Success** — inline edits save with row pulse.

### Interaction behavior
- `.astro` SSR table; sort + filter client-side.
- Click row → `/clients/:id` (or right-rail expand on desktop — pick one; designs assume right-rail).
- Add client manually: top-right button → modal.

### Tokens
None new.

### Components
- Reused: `<DataTable />`, `<StatusPill />` (relationship), `<Card />`, `<EmptyState />`

### Content rules
- Win rate `42%` (no decimal). `—` if `total_quotes < 3`.
- Lifetime values: compact format `$184k`.
- Last activity: relative.

### Accessibility
- Table: standard semantic table; column headers are buttons when sortable.

---

## 7. Dashboard (`/insights`)

### Scope
**Full redesign** of `web/src/pages/insights.astro`. Single layout (Zones). The Agenda layout is dropped — that lives in `/bids` now.

### Mockups
- `screenshots/dashboard/01-zones.png` — KPIs, pipeline funnel, capacity, recent activity
- `screenshots/dashboard/02-empty.png` — cold-start
- `screenshots/dashboard/03-calibrating.png` — first 5 quotes, learning disclaimer
- `screenshots/dashboard/mobile.png` — stacked

### Every state
- **Default** — four KPI tiles, pipeline value funnel, weekly capacity gauge, last 10 events.
- **Loading** — KPI skeletons; funnel placeholder.
- **Empty (cold-start)** — "Numbers show up here after your first quote. There's nothing meaningful to chart yet." + CTA → `/generate`.
- **Calibrating** — quotes 1–5: tiles render with a muted "Brief is calibrating" disclaimer below the value. Trend arrows hidden.
- **Error** — KPI fetch fails individually: show em-dash with "couldn't load" tooltip; don't fail the whole page.
- **Hover/focus** — KPI tile hover lifts shadow; clickable if `href`.
- **Disabled** — n/a.

### Interaction behavior
- `.astro` SSR all KPIs (no client-side fetch on load).
- Click KPI → drills into the corresponding filtered list view.
- Activity feed updates via polling at 60s (low-priority — refresh button always available).

### Tokens
None new.

### Components
- Reused: `<MetricCard />`, `<Card />`, `<EmptyState />`
- New: `<PipelineFunnel />` (small svg chart), `<CapacityGauge />` (simple bar)

### Content rules
- KPI value formatting per `README.md` compact rules: `$184k`, `12`, `42%`.
- Sparklines: 8 weeks of weekly values.
- Activity feed: relative timestamps.

### Accessibility
- KPI deltas have `aria-label="up 12 percent week over week"`.
- Charts have an accessible text alternative below (visually hidden) summarizing the trend.

---

## 8. Settings (`/settings`)

### Scope
**New route.** Sections: Account, Shop & license, Pricing defaults, Connected services, Branding, Notifications, Data export.

### Mockups
- `screenshots/settings/01-account.png` — Google profile, sign out
- `screenshots/settings/02-shop-license.png` — license number + jurisdiction
- `screenshots/settings/03-pricing.png` — markup, labor rate
- `screenshots/settings/04-integrations.png` — ProService, Google Calendar, QuickBooks, DocuSign, Drive
- `screenshots/settings/05-branding.png` — logo, color, footer text
- `screenshots/settings/mobile.png` — vertical sections

### Every state
- **Default** — sections render with current values.
- **Loading** — section skeletons; sticky save bar appears only when dirty.
- **Empty** — n/a (always has the shop's data).
- **Error** — save failure: inline toast under the field; field stays dirty.
- **Hover/focus** — standard.
- **Disabled** — fields disabled while saving; integrations show "Connecting…" with disabled button.
- **Success** — section pulses accent on save; sticky save bar disappears.

### Interaction behavior
- `.astro` SSR all sections.
- Each section is an independent Solid island with local form state.
- Save: `PATCH /api/shops/me` with the dirty section's payload.
- Integration connect: opens OAuth popup (Google Calendar, QuickBooks, DocuSign, Drive); ProService Hawaii uses an API key form (not OAuth).
- Disconnect: inline confirm "Disconnect Google Calendar? Brief won't be able to suggest send times" → POST `/api/integrations/.../disconnect`.

### Tokens
None new.

### Components
- Reused: `<Card />`, `<Field />`, `<Button />`, `<Stepper />` (no — Settings doesn't use it)
- New: `<IntegrationRow />` (icon + name + state + action button + sub-text)

### Content rules
- Markup percent: integer or one decimal.
- Labor rate: `$92.00/hr`.
- Connected timestamps: relative ("Connected 12 min ago").

### Accessibility
- Each section is `<section aria-labelledby="section-h2">`.
- Disconnect confirm uses native `<dialog>` semantics; Esc cancels.
- Sticky save bar: announced via `aria-live="polite"` when it appears.
