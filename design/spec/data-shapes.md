# Data shapes

Shapes the prototype assumes. **None are pulled from your real `supabase.ts` / `pricing.ts`** — confirm each, file schema migrations for any that don't fit.

Convention:
- All ids are `text` (uuid) unless noted.
- Money is `numeric(12,2)` in cents-as-dollars; render via the currency rule in `README.md`.
- Timestamps are `timestamptz`.
- `null` is the default for not-yet-set; render as em-dash.

## `quotes`

Drives `/bids`, `/generate`, `/quotes/[id]`.

```ts
type Quote = {
  id: string;                       // q_2026_0042
  ref: string;                      // "Q-2026-0042"  — display
  shop_id: string;                  // FK → shops
  client_id: string;                // FK → clients
  client_name: string;              // denorm for list views
  client_contact_name: string | null;
  project_title: string;            // "ADU foundation — Ridgemoor"
  scope_summary: string | null;     // serif-rendered next-step blurb
  state: 'DRAFT' | 'SENT' | 'AWAITING' | 'RESPONDED' | 'WON' | 'LOST';
  total: number;                    // estimated_value (existing column?)
  line_items: QuoteLineItem[];      // see below
  created_at: string;
  sent_at: string | null;
  responded_at: string | null;      // last client touch
  age_days: number;                 // derived: now - max(sent_at, responded_at, created_at)
  relationship: 'new' | 'referral' | 'repeat';
  next_step: string | null;         // serif "what's next" line, editable
  source: 'upload' | 'voice' | 'manual' | 'site_visit';
  source_artifact_url: string | null;  // the uploaded PDF/photo/voice memo
  margin_pct: number | null;        // computed
};

type QuoteLineItem = {
  id: string;
  description: string;
  qty: number;
  unit: 'each' | 'hr' | 'sqft' | 'lf' | 'cy' | 'day';
  unit_price: number;
  subtotal: number;                 // qty * unit_price
  category: 'labor' | 'materials' | 'subs' | 'permits' | 'equipment' | 'other';
  confidence: 'high' | 'med' | 'low' | 'manual';  // AI confidence; 'manual' = user-entered
  source_excerpt: string | null;    // the bit of source doc this came from
};
```

**Schema callouts:**
- `relationship`, `next_step`, `source`, `source_artifact_url`, `margin_pct` — likely new columns.
- `line_items` — if currently stored as JSON blob, leave it; if relational, an `id` per item is required for SSE partial-rendering.
- `confidence`, `source_excerpt` on line items — **new**, required for the AI scan UI to show "why" rows are highlighted.

## `jobs`

Drives `/jcr`.

```ts
type Job = {
  id: string;
  ref: string;                      // "J-2026-0017"
  quote_id: string;                 // FK
  shop_id: string;
  client_id: string;
  client_name: string;
  project_title: string;
  state: 'SCHEDULED' | 'INPROGRESS' | 'CLOSED';
  scheduled_start: string | null;
  actual_start: string | null;
  scheduled_end: string | null;
  actual_end: string | null;
  crew_ids: string[];               // FK → people
  cost_lines: CostLine[];           // see primitives.md
  totals: {
    estimated: number;              // sum of quote line items
    actual: number;                 // sum of actual cost lines
    variance: number;
    variance_pct: number;
  };
  payroll_synced_at: string | null; // null if ProService not connected
};
```

**Schema callouts:**
- `cost_lines` — almost certainly a new table (`job_cost_lines`). Migration required.
- `payroll_synced_at` — new; only populated when ProService Hawaii integration is on.

## `clients`

Drives `/clients`.

```ts
type Client = {
  id: string;
  name: string;
  type: 'residential' | 'commercial' | 'gc' | 'public';
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  primary_contact_phone: string | null;
  address_line: string | null;
  city: string | null;
  state_code: string | null;        // 'HI'
  notes: string | null;             // free-text, serif-rendered
  total_quoted: number;             // lifetime, computed
  total_won: number;                // lifetime, computed
  win_rate_pct: number | null;      // computed; null if fewer than 3 quotes
  last_activity_at: string | null;
};
```

**Schema callouts:** All new, almost certainly.

## `shops` (profile)

Drives `/onboarding`, `/settings`.

```ts
type Shop = {
  id: string;
  legal_name: string;
  trade_name: string | null;
  license_number: string | null;    // CSLB (Cavy) / DCCA (Marlon) — same column
  license_jurisdiction: string;     // 'CA' | 'HI' | ...
  license_classification: string | null;  // "B-General", "C-33", etc.
  license_expires_at: string | null;
  owner_name: string;
  owner_email: string;
  default_markup_pct: number;       // pricing default
  default_labor_rate: number;       // pricing default
  payroll_connected: boolean;       // ProService Hawaii
  google_calendar_connected: boolean;
  google_calendar_scope: 'read' | 'denied' | null;
  brief_calendar_id: string | null; // the Brief-created calendar in user's Google account
  quickbooks_connected: boolean;
  docusign_connected: boolean;
  drive_connected: boolean;
  voice_sample_url: string | null;  // the upload from onboarding step 2
  voice_sample_processed_at: string | null;
  data_state: 'cold-start' | 'calibrating' | 'calibrated';  // derived; see empty-states.md
};
```

**Schema callouts:**
- `voice_sample_url`, `voice_sample_processed_at` — new; load-bearing for the onboarding trust moment.
- `data_state` — derived; either compute it or materialize. Currently the prototype assumes it's computable from quote count + time since first quote.
- `brief_calendar_id` — populated after the Calendar Pattern A consent.

## `quote_messages` (Reply/Nudge thread)

New table. Drives the Reply/Nudge slide-over.

```ts
type QuoteMessage = {
  id: string;
  quote_id: string;
  direction: 'inbound' | 'outbound';
  channel: 'email' | 'sms' | 'manual';
  subject: string | null;
  body: string;
  draft: boolean;                   // outbound only
  draft_reasoning: string | null;   // "Why this draft" copy
  drafted_by: 'brief' | 'user';     // outbound only
  scheduled_for: string | null;     // null = send now
  sent_at: string | null;
  created_at: string;
};
```

**Schema callouts:** New table. Required for Reply/Nudge to work at all.

## `events` (audit log; lightweight)

```ts
type Event = {
  id: string;
  shop_id: string;
  quote_id?: string;
  job_id?: string;
  type: string;       // 'quote.sent', 'quote.opened', 'quote.responded', 'nudge.sent', ...
  payload: Record<string, unknown>;
  created_at: string;
};
```

Used by the Agenda view to compute `age_days` and "Cooling off" groups, and by Dashboard for the activity feed. Probably already exists in some form — confirm column names.

## Summary of new tables/columns

| Table | Status |
|---|---|
| `quotes` | Likely exists — confirm columns: `relationship`, `next_step`, `source`, `source_artifact_url`, `margin_pct` |
| `quote_line_items` | Likely exists — add `confidence`, `source_excerpt` |
| `jobs` | Likely exists — confirm |
| `job_cost_lines` | **New table** |
| `clients` | **New table** (probably) |
| `quote_messages` | **New table** |
| `events` | Confirm shape |
| `shops` | Add: `voice_sample_url`, `voice_sample_processed_at`, `google_calendar_*`, `brief_calendar_id`, all integration flags, `data_state` (or derive) |

**Recommendation:** land migrations as the first PR after `tokens.md` is merged. The Agenda view and Reply/Nudge drawer have hard dependencies on `quote_messages` and the new `quotes` columns.
