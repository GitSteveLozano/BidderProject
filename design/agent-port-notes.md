# Agent port notes — what to preserve when the Python tree is deleted

The Python `agents/`, `tools/`, `api/`, `cli.py`, `streamlit_app.py` are deleted in PR 1. This doc is the persistent record of the **ideas** — prompts, math, tool shapes, contracts — that should reincarnate as TypeScript in the Brief codebase. The 5-layer / 8-agent architecture continues conceptually; only the runtime changes.

Source git ref before deletion: see `main` prior to PR 1 (`90667cf` and earlier).

---

## Mapping: old agent → Brief PR + new location

| Old (Python) | Concept | Brief target | PR |
|---|---|---|---|
| `agents/intake.py` | One-shot doc → JSON parse | `/api/voice/analyze` (onboarding step 2) + `/api/quote/scan` (quote production step 2) | 3, 4 |
| `agents/context.py` | Load company profile + voice | Replaced by direct Supabase reads | 1 |
| `agents/pricing.py` + `pricing_tool_use.py` | Deterministic price math + LLM narrative | Pricing step (Solid signals client-side); narrative in `/api/quote/scan` payload | 4 |
| `agents/composition.py` | Streaming bid markdown w/ voice + exclusions | Subsumed by PR 4 SSE line-item stream + PR 5 quote-detail render | 4, 5 |
| `agents/follow_up.py` | Cadence + drafted emails | `/api/quote/draft-reply` + `/api/quote/draft-nudge` (Reply/Nudge drawers) | 5 |
| `agents/jcr.py` | Job-cost reconciliation math + narrative | `<CostReconciliation />` data layer + `/api/job/cost-line/reconcile` | 6 |
| `agents/intelligence.py` | Weekly cross-cutting insights | Dashboard KPIs + an Insights surface (cold-start hidden until n≥15 bids) | 6, 7 |
| `agents/postmortem.py` | Loss postmortem on a single LOST quote | Future redesign (out of v1 scope). Prompt below for when it returns. | — |

`agents/converse.py` (chat-about-a-bid) and `agents/orchestrator.py` (in-process state machine) are not ported — UI orchestrates via REST/SSE in Brief.

---

## Intake — `/api/voice/analyze` and `/api/quote/scan`

### System prompt (from `agents/intake.py:14`)

```
You parse construction-industry documents into structured JSON.

Document types you handle:
- past_quote: a contractor's prior estimate (line items, exclusions, pricing)
- rfp: a request for proposal from a general contractor or owner
- drawings: architectural / construction drawings (cover page + sheet list usually)
- scope_email: an informal scope description sent over email
- change_request: a request to change scope or pricing on an existing bid

You ALWAYS return valid JSON matching the schema described in the user message.
You do NOT invent fields. Missing fields → null. Low confidence → confidence_score < 0.7.

You recognize specialty-contractor terminology:
- Stucco service lines: STUCCO-CONVENTIONAL, STUCCO-textured acrylic, EIFS, RESTUCCO
- Siding service lines: hardie, gentek, LUX, metal cladding
- Common exclusions: rough grade above final grade, painting, caulking joints,
  electrical, plumbing, permitting
- Pricing units: lump_sum, per_sqft, per_lf, hourly
```

### Output JSON shape (verbatim from user template)

```json
{
  "document_classification": "past_quote|rfp|drawings|scope_email|change_request",
  "client_info": {
    "client_name": "string|null",
    "client_address": "string|null",
    "project_name": "string|null"
  },
  "service_line_hint": "STUCCO-CONVENTIONAL|EIFS|Siding|...|other|null",
  "scope_items": [
    {"description": "string", "quantity": "number|null", "unit": "string|null"}
  ],
  "exclusions_mentioned": ["string"],
  "inclusions_mentioned": ["string"],
  "pricing_mentioned": {
    "total": "number|null",
    "labor_subtotal": "number|null",
    "material_subtotal": "number|null",
    "currency": "USD"
  },
  "deadline": "YYYY-MM-DD|null",
  "addenda_or_changes": ["string"],
  "confidence_score": "number 0..1"
}
```

### Brief differences from the Python version

- **Streaming, not one-shot.** Python returned the whole JSON at once. Brief streams **one tool-use call per `line_item`** via SSE so the Scope step renders rows as they're identified. The output shape becomes per-event:
  - `{type:"progress", payload:{percent:42}}`
  - `{type:"line_item", payload:{description, qty, unit, unit_price, subtotal, category, confidence, source_excerpt}}`
  - `{type:"flag", payload:{kind:"warn"|"info", text}}`
  - `{type:"done"}`
  - `{type:"error", payload:{message}}`
- **Model:** Haiku for routing/extraction; Sonnet fallback on JSON parse failures or low-confidence. Same heuristic as Python (`agents/intake.py:113-120`).
- **Confidence floor:** `< 0.7` → `needs_human_review = true`. Keep this exact threshold.

---

## Pricing — math (deterministic, not LLM)

These formulas come from `agents/pricing.py:46`. **Every number traces to a tool call.** The LLM only writes the narrative rationale, never modifies a number.

```
base_cost          = labor_subtotal + materials_subtotal
overhead_amount    = base_cost × (overhead_pct / 100)            // default overhead_pct = 18.0
cost_with_overhead = base_cost + overhead_amount
target_price       = cost_with_overhead / (1 − target_margin_pct/100)   // default target_margin_pct = 32.0
profit             = target_price − cost_with_overhead
range_low          = cost_with_overhead / (1 − margin_range_low_pct/100)   // default 25.0
range_high         = cost_with_overhead / (1 − margin_range_high_pct/100)  // default 40.0
```

Defaults if `shops.default_*` is null: overhead 18%, target margin 32%, range 25–40%.

### Capacity modifier (from `tools/capacity_lookup.py:89`)

Translate first-week utilization into a pricing recommendation surfaced to the user. Recommendation only — never auto-adjusts price.

```
utilization >= 0.85  → action: "hold_firm"               modifier_pct:  0.0
utilization >= 0.70  → action: "hold"                    modifier_pct:  0.0
utilization >= 0.50  → action: "consider_small_discount" modifier_pct: -2.5
utilization <  0.50  → action: "consider_discount"       modifier_pct: -5.0

Rationales:
  hold_firm: "schedule is full; hold target price"
  hold:      "healthy utilization; price at target"
  consider_small_discount: "moderate utilization; minor discount to win work may be worth it"
  consider_discount:       "low utilization; discount to fill schedule is consistent with company behavior"
```

`utilization = sum(allocated_hours) / (active_headcount × 40)` per week (Hawaii standard 5-day, 8-hour week).

### Pricing narrative — system prompt (`agents/pricing.py:144`)

```
You write a 3-4 sentence pricing rationale for a specialty contractor. You
MUST NOT change or invent any numbers — you only narrate the facts provided.
Mention capacity context if utilization is given. Keep it operational and
direct.
```

Model: Sonnet, max_tokens 512, temperature 0.3.

---

## Composition — bid markdown in voice

### System prompt (`agents/composition.py:12`)

```
You write specialty-contractor bid documents in the company's own voice. You have:
- The company's voice patterns (tone, sentence length, preferred terms, boilerplate)
- The service-line scope template
- A pre-computed pricing breakdown (authoritative — do NOT change numbers)
- The standard exclusions for this service line

Output format (markdown):
1. Greeting / boilerplate intro (in voice)
2. Project header (client, address, brief description)
3. Scope of work (use scope template language; specific to this job)
4. Inclusions (call them out explicitly)
5. **Exclusions** (list ALL standard exclusions for this service line — do not skip any)
6. Pricing (use exact numbers from the pricing breakdown)
7. Payment terms and warranty (from boilerplate)
8. Boilerplate closing

DO NOT:
- Invent or modify pricing numbers
- Skip exclusions
- Use language outside the company's voice patterns
- Add a competitor analysis or marketing copy

Return ONLY the markdown bid document — no preamble, no code fence.
```

Model: Sonnet, max_tokens 3000, temperature 0.4.

### Prompt-caching strategy (load-bearing for cost)

`agents/composition.py:84` splits the prompt deliberately:

- **System block** = `SYSTEM_PROMPT` (immutable across all bids)
- **System-extra block, cached:** per-company voice profile + service line scope template + standard exclusions list — `JSON.stringify(sortedKeys)` so the bytes don't vary across requests
- **User message:** per-bid volatile facts (scope summary, client, pricing numbers)

This lets us reuse the cache across every bid for the same shop. **Critical for Brief** — bid generation cost balloons without this. In TypeScript, use Anthropic SDK's `cache_control: { type: 'ephemeral' }` on the system content block.

### Exclusions verification heuristic (`tools/exclusions_verify.py:28`)

Pure non-LLM check, runs after the draft is rendered. For each `standard_exclusion`:

1. Tokenize both the exclusion phrase and the draft, lowercasing and dropping stopwords (`the, a, an, of, to, in, on, and, or, for, with, is, are, be, by, as, at, from, not, should, this, that, any, all`).
2. **Verbatim phrase check:** if the first 5 content tokens of the exclusion appear contiguously in the tokenized draft → present.
3. **Token-set overlap:** if `≥70%` of the exclusion's content tokens appear anywhere in the draft → present.
4. Otherwise → missing.

Already ported in `web/src/pages/api/bids/generate.ts:251–270` (lift directly). Keep this heuristic — false positives are worse than false negatives for exclusions.

---

## Follow-up — cadence rules (`tools/cadence_lookup.py:9`)

```
client_segment === 'repeat':
  step 1: t + 5d        channel: email   tone: "soft, relationship-respecting"

client_segment === 'cold' | 'new' | unknown:
  step 1: t + 48h       channel: email   tone: "warm check-in"
  step 2: t + 5d        channel: email   tone: "direct"
  step 3: t + 10d       channel: email   tone: "final, escalating"
```

`t` = the moment the quote was sent. In Brief, this drives the Reply/Nudge drawer suggestion ("Send 9 AM tomorrow", "Send Tue 9 AM") combined with Calendar free/busy.

### Draft-message system prompt (`agents/follow_up.py:81`)

```
You draft short, professional follow-up emails for a specialty contractor.
The tone parameter is authoritative — match it. Keep messages under 8
sentences. Reference the specific project. Do not be pushy or use marketing
language. End with the company's boilerplate closing if provided.
```

Model: Sonnet, max_tokens 512, temperature 0.5.

---

## Job-Cost Reconciliation — math (`agents/jcr.py:13`)

```
actual_total = actual_labor_cost + actual_material_cost + actual_other_costs

delivered_margin_pct      = (quoted_price − actual_total) / quoted_price × 100
variance_labor_hours_pct  = (actual_hours − quoted_hours) / quoted_hours × 100
variance_total_cost_pct   = (actual_total − quoted_price) / quoted_price × 100
```

Variance color thresholds (per `tokens.md`):
- `< 0` (under bid): `text-good`
- `0..5%`: neutral
- `5..20%` over: `text-warn`
- `> 20%` over: `text-danger`

### Pattern detection (nightly batch)

Surface a pattern claim only when **n ≥ 8** completed jobs in a service line AND `|avg_labor_variance_pct| ≥ 5%`. Recommendation: "Consider updating {service_line} labor hour formula by {±X}%".

### Reconciliation narrative system prompt (`agents/jcr.py:198`)

```
You narrate a job-cost reconciliation result in 3-5 sentences for a
specialty contractor. Be specific with numbers. DO NOT invent or modify any
figures — quote them verbatim from the input. Mention the delivered margin
and the variance direction. Keep it operational.
```

Model: Sonnet, max_tokens 512, temperature 0.3.

---

## Intelligence — operating insights (`agents/intelligence.py`)

Thresholds:
- `MIN_SUPPORTING_BIDS = 15` — never claim a pattern with fewer
- `NOISE_FLOOR_MARGIN_DRIFT_PCT = 3.0` — drift below this is noise

Three insight categories (matches Dashboard groupings):

1. **Capacity-aware pricing.** Trigger: `avg_utilization ≥ 0.80` over next 8 weeks AND `≥ 1` open quote. Recommendation: hold price firm on the top open quote.
2. **Margin drift per service line.** Trigger: `|avg_margin − typical_margin_pct| ≥ 3pp` AND `n ≥ 4` reconciled jobs. Recommendation: adjust labor hour formula by avg labor variance %.
3. **Exclusions enforcement.** Trigger: any standard exclusion missing on `≥ 3` recent bids in the same service line. Recommendation: auto-flag in Composition.

### Intelligence narrative system prompt (`agents/intelligence.py:227`)

```
You write 3-5 sentence operating-intelligence findings for a specialty
contractor. Be specific with numbers from the facts. DO NOT invent numbers.
End with an actionable recommendation.
```

Model: Sonnet, max_tokens 512, temperature 0.3. Cache the system prompt across all insight calls in one analysis run.

---

## Loss postmortem — for future redesign (`agents/postmortem.py:26`)

Out of v1 scope but the prompt is worth preserving:

```
You write structured loss-postmortem analyses for a specialty contractor.
You are given:
- The lost bid (scope, our price, our labor hours, our exclusions)
- The winning competitor's name and price (when known)
- The company's pricing logic (target margin, range, capacity behavior)
- Recent comparable LOST bids for this service line
- Win rate history for similar price bands

Produce structured JSON in this exact shape (return ONLY the JSON):

{
  "likely_reasons": [str],
  "price_gap_analysis": {
    "our_price": number,
    "winning_price": number|null,
    "delta_usd": number|null,
    "delta_pct": number|null,
    "interpretation": str
  },
  "exclusions_signal": str,
  "capacity_factor": str,
  "pattern_across_recent_losses": str,
  "recommendations_for_next_bid": [str],
  "confidence": "low" | "medium" | "high"
}

Rules:
- Reasons must be specific to this bid — never generic "they were cheaper".
  Reference the price delta, exclusions diff, capacity at quote, etc.
- Confidence is "low" when n<3 comparable losses, "medium" at 3-7, "high" at 8+.
- DO NOT invent numbers. Every dollar/percent comes from the facts provided.
```

Pin the `price_gap_analysis` numbers server-side after the LLM returns — never trust the LLM to copy them verbatim.

---

## Trade match table (`tools/labor_cost_lookup.py:12`)

Quote intake normalizes free-text trade descriptions to canonical classifications:

```
stucco_lead       → ['lead_stucco_mech']
stucco_journeyman → ['stucco_journeyman', 'lead_stucco_mech']
stucco            → ['stucco_journeyman', 'lead_stucco_mech', 'finisher']
eifs              → ['eifs_installer', 'stucco_journeyman']
siding_lead       → ['siding_lead']
siding            → ['siding_installer', 'siding_lead']
finisher          → ['finisher']
laborer           → ['general_laborer']
helper            → ['general_laborer']
```

In Brief, this lives in `web/src/lib/labor-classifications.ts` once we wire payroll lookups (post v1).

---

## Material rate catalog (`tools/material_cost_lookup.py:11`)

Per-unit Hawaii-2026 ballpark rates with waste factors:

| Service line | Unit | Cost/unit | Waste |
|---|---|---:|---:|
| STUCCO-CONVENTIONAL | sqft | $7.20 | 10% |
| STUCCO-textured acrylic | sqft | $8.40 | 10% |
| EIFS | sqft | $11.50 | 8% |
| Siding | sqft | $9.80 | 12% |
| METAL WORK | lf | $14.00 | 8% |
| RESTUCCO | sqft | $5.40 | 10% |
| REPAIR | lump_sum | $1.00 | 0% |
| DEMOLITION | sqft | $2.80 | 0% |

Formula: `subtotal = quantity × (1 + waste) × cost_per_unit`.

In Brief this becomes a `pricing_defaults` row per shop, editable in Settings → Pricing defaults.

---

## State machine — bid/quote lifecycle

Old (Python): `DRAFT → DRAFT_GENERATED → EXCLUSIONS_REVIEW → HUMAN_REVIEW → SENT → FOLLOW_UP_1_SENT → FOLLOW_UP_2_SENT → FOLLOW_UP_3_SENT → RESPONDED → WON|LOST`.

New (Brief, per `data-shapes.md`): `DRAFT → SENT → AWAITING → RESPONDED → WON|LOST`.

Simpler. Exclusions-review is folded into DRAFT; follow-up sub-states collapse into `AWAITING` (cadence drives Reply/Nudge suggestions, not state transitions).

---

## What is intentionally NOT preserved

- **`api/` FastAPI app** — Brief uses Astro API routes. No Python service layer.
- **`tests/` pytest suite** — tested against the old schema/agents. New tests are TypeScript, ship with the PRs that introduce the surfaces.
- **`agents/orchestrator.py`** — in-process state machine. Brief's UI orchestrates via REST + SSE.
- **`agents/converse.py`** — chat-about-a-bid surface. Not in Brief design.
- **`pricing_logic` / `voice_patterns` / `service_lines` tables** — replaced by `shops.default_*` columns and per-shop settings.
- **pgvector embeddings (`voice_embedding`)** — voice analysis in Brief is one-shot extraction via Claude tool-use, no similarity search.
- **Celery / Redis** — async work in Brief is Cloudflare Workers cron + Supabase Edge Functions.

---

## Where to look in commit history

The Python implementations live in `main` prior to PR 1. Useful refs:

- `cc26467` — initial multi-agent backend with real tool-use pricing
- `df6140a` — agent + API tests, tool-use pricing flag, structured logging
- `09114eb` — pricing + intake agent tests, cost estimation, audit log
- `45a2fba` — prompt caching, voice-fidelity tests, brief PDF generator
- `689983c` — loss postmortem, Anthropic Batch API integration

If a future surface needs detail that's not in this doc, that's the place to dig.
