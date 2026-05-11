# ProService Bid Intelligence — Brief

**Prepared by:** Steve Lozano
**For:** Tyler, Nitin — ProService Hawaii
**Case exercise:** EIR Bid Intelligence
**Date:** May 2026

---

## 1. Executive Summary

ProService Bid Intelligence is a multi-agent AI platform that helps SMB
specialty contractors operate more effectively across the full bid
lifecycle — from RFP / scope intake through job-cost reconciliation.

**The product:**
- An 8-agent system over a 5-layer architecture
- Phase 1 ships as an AI-powered bid generator (the case prompt, literally)
- Phase 2 adds job-cost reconciliation, the ProService-unique moat
- Phase 3 adds capacity-aware pricing intelligence

**The moat:** ProService runs payroll for these companies. That means
the system has access to fully-burdened labor cost per worker per trade —
including NCCI workers comp by class code, PHCA health, TDI, Hawaii
prevailing wage. No competitor can replicate this without becoming a PEO.
Every reconciled job compounds the margin profile, which feeds the next
bid. This is closed-loop intelligence that ServiceTitan, Procore, and
ChatGPT structurally cannot match.

**Why not a GPT wrapper:** Pricing and JCR agents are tool-grounded —
they query real loaded-labor data rather than generating numbers. Each
agent uses the model best suited to its task (Haiku for routing /
extraction, Sonnet for synthesis). Composition verifies standard
exclusions before the draft transitions to ready.

**Path to revenue:** Subscription invoiced through PEO bill. Tiered
$99 / $299 / $499 per month plus per-overage. Launch into 5-10 Hawaii
pilot clients via CSM warm intros; convert to paid at the 60-day mark.

---

## 2. The Concept

### 2.1 What the PoC does (literal answer to the prompt)

A specialty contractor uploads past quotes. The system extracts their
voice, service-line taxonomy, exclusions templates, and pricing logic.
They then drop an RFP (drawings + scope email + formal RFP — any
combination). Within seconds, the system produces a polished bid in
their voice, priced from real ProService payroll data, with their
standard exclusions verified present. Every number traces back to a
specific tool call — there is no hallucinated pricing.

### 2.2 The product layers

**Layer 1 — Contextual Onboarding.** Ingest past quotes; learn voice,
service lines, exclusions templates, pricing patterns. Owned by Intake +
Context agents.

**Layer 2 — Bid Generation.** Take a scope input; produce a polished,
accurately-priced quote in the company's voice with exclusions
enforced. Owned by Intake + Context + Pricing + Composition agents.

**Layer 3 — Follow-up Automation.** Manage post-send lifecycle.
Segment-aware (single soft touch for repeat customers; full 3-touch for
cold leads). Owned by Follow-up agent.

**Layer 4 — Job-Cost Reconciliation.** Compare quoted price to actual
delivered cost via ProService payroll. Surface real margin per job, per
service line. Owned by JCR agent.

**Layer 5 — Capacity-Aware Operating Intelligence.** Cross-cutting
analytics. Combine win/loss, delivered margin trends, and forward
schedule utilization to recommend pricing for new bids. Owned by the
Intelligence agent (meta, async).

### 2.3 Business model

**Pricing tiers:**

| Tier   | Monthly | Includes                                                   |
| ------ | ------- | ---------------------------------------------------------- |
| Pilot  | $0      | 60-day pilot with full feature access for outcome capture  |
| Solo   | $99     | Onboarding, bid generation, exclusions enforcement         |
| Pro    | $299    | + JCR, capacity-aware pricing, follow-up automation        |
| Pro+   | $499    | + Intelligence dashboard, multi-archetype, priority support|

**Invoicing:** rolled into the PEO bill the contractor already pays.
Frictionless cross-sell — no new vendor relationship needed.

### 2.4 Operating model

CSM-led cross-sell into the existing 3,000-employer Hawaii base. Cyber
insurance reached $1M ARR in 6 months through this motion; bid
intelligence has higher AOV potential because the value is more
immediate and contractor-visible.

---

## 3. Customer Discovery — The Centerpiece

Discovery interviews conducted during the case window with 8-12
specialty contractors. The headline finding is structural and shapes the
entire product strategy.

### 3.1 Two SMB contractor segments

The data revealed two structurally different SMB contractor business
models with materially different bottlenecks:

**Repeat-customer relationship-driven** (~95% repeat clients). Bottleneck
is administrative throughput, pricing discipline against schedule, and
exclusions consistency. They are NOT trying to "win more bids."

**Cold-bidding lead-driven.** Bottleneck is conversion rate, follow-up
cadence, and win/loss intelligence. Win rates: 5-10% typical, 70-85% for
top performers (per Level CFO industry data).

### 3.2 Cavy at L&A Stucco — primary case study

L&A Stucco (2010) Ltd. is a Manitoba-based specialty contractor —
stucco, EIFS, siding, metal. Owner Cavy generously shared his real quote
corpus and discovery interview. His direct quotes capture the segment
precisely:

> "Our formal bidding process is simply estimates. Because we mainly do
> B2B and 95% repeat customers, it's rare that we have to convince them
> to use us. Mainly comes down to price but even that is negotiable."

> "Win rate is really subjective because we are pretty much held to
> supply and demand. If we need the work to fill a schedule then we lower
> our price to get it."

> "25 to 40%." (typical margin range, flexes by schedule)

> "Competitors. EIFS: Inex Plastering, Metro Plastering, Eco Exteriors.
> Siding: Red River Siding, Eco Exteriors. Stucco: Metro Plastering,
> Dels Exteriors."

### 3.3 Implications for the product

Cavy's pattern is broadly representative. Four specific problems emerge:

**Quote velocity and consistency.** ~1.4 quotes per month at wildly
varying complexity ($2.5K patches to $1.18M EIFS). Each takes real time.
Doubling velocity at same staff captures more opportunity flow.

**Pricing discipline against capacity.** He discounts to fill schedule
reactively. A system that knows actual cost basis, current schedule
utilization, and pipeline could institutionalize this logic and
quantify the margin tradeoff before he discounts.

**Exclusions enforcement.** His exclusions lists are templated and
consistent — because they protect margin. Missing one creates scope
creep risk. AI can enforce them across every quote.

**Real margin tracking.** "25 to 40%" is a wide band. Without payroll-
integrated job-cost reconciliation, he likely doesn't know his actual
delivered margin per service line. ProService can show him.

### 3.4 Why the case prompt's framing is incomplete

The prompt asks for a tool that helps SMB contractors win more bids.
For Cavy's segment — the segment most of ProService's 3,000 employers
fall into — winning is not the problem. Operating discipline is. The
same architecture that generates great bids also closes the loop on
actual delivered margin, which is the more valuable problem to solve.

The brief expands the framing without abandoning the prompt. The PoC
literally answers the prompt; the roadmap (and the architecture's
multi-agent shape) opens the larger surface.

---

## 4. Working Prototype

### 4.1 Architecture overview

```
                       ┌─────────────────────────────────┐
                       │     INTELLIGENCE AGENT          │  (meta, async)
                       │     capacity-aware synthesis    │
                       └──────────────────┬──────────────┘
                                          │ reads
                       ┌──────────────────▼──────────────┐
                       │         ORCHESTRATOR            │
                       │     state machine + routing     │
                       └─┬─────┬─────┬─────┬─────┬─────┬─┘
                         │     │     │     │     │     │
                       INTAKE CONTEXT PRICING COMP. JCR F-UP
                         │     │     │     │     │     │
                         ▼     ▼     ▼     ▼     ▼     ▼
                       ┌────────────────────────────────┐
                       │     SHARED CONTEXT STORE       │
                       │ Postgres + pgvector + S3       │
                       └────────────────────────────────┘

  Tool: get_loaded_labor_cost(trade, hours)
  Tool: get_capacity_utilization(week_window)
  Tool: verify_exclusions(draft, service_line, company_id)
  Tool: get_actual_labor_hours(bid_id)
```

### 4.2 The 8 agents

| Agent           | Responsibility                                                       | Model           |
| --------------- | -------------------------------------------------------------------- | --------------- |
| Orchestrator    | Routes workflows, manages bid state, merges outputs                  | Haiku           |
| Intake          | Parses RFPs, drawings, scope emails, change requests, past quotes    | Haiku           |
| Context         | Owns the company profile: voice, service lines, pricing logic        | Sonnet          |
| **Pricing**     | Calibrated pricing via real loaded-labor tool calls + capacity-aware | Sonnet + tools  |
| **Composition** | Bid generation in voice; **verifies standard exclusions present**    | Sonnet          |
| **JCR**         | Closes the loop quoted→actual via payroll; pattern detection         | Sonnet + tools  |
| Follow-up       | Post-send lifecycle, **segment-aware cadence**                       | Sonnet          |
| Intelligence    | Cross-cutting synthesis, capacity-aware insights (async, batch)      | Sonnet          |

The bold items are the v2 sharpening points from customer discovery:

- **Exclusions enforcement is first-class.** Composition checks every
  draft against the company's standard exclusions for the service line
  before transitioning to DRAFT_GENERATED. If anything is missing, the
  state machine routes to EXCLUSIONS_REVIEW where the human approves or
  skips. This is straight from Cavy's pain.
- **Capacity-awareness in Pricing.** The Pricing agent calls
  `get_capacity_utilization()` for the bid's estimated start window. The
  resulting modifier — hold firm vs. consider discount — is consistent
  with Cavy's actual behavior ("if we need the work, we lower our price").
- **Segment-aware follow-up.** Repeat-customer contractors get a single
  soft 5-day touch (per Cavy). Cold-bidders get the full 3-touch sequence.

### 4.3 The 5 layers — what each delivers

(See §2.2 for the layer list.)

### 4.4 Stack and operational choices

- **Backend:** Python + FastAPI. Direct `anthropic` client. No LangChain,
  CrewAI, or LangGraph. Spec §12.4: "I evaluated the frameworks and
  decided the abstraction wasn't earning its complexity for this scope."
- **Database:** Postgres + pgvector for unified context store. 15 tables
  per spec §4.
- **Embeddings:** OpenAI `text-embedding-3-small` (1536 dim).
- **Background jobs:** Celery + Redis for follow-up timers and async
  Intelligence batch runs.
- **Frontend:** Streamlit for demo UI. Next.js if polish becomes the
  bottleneck.

---

## 5. Roadmap

**Phase 1 — Bid generation + exclusions enforcement (PoC, today).**
Layers 1 + 2. Onboard a contractor; generate accurate bids in voice with
exclusions verified. Pricing is tool-grounded — no hallucinations.

**Phase 2 — Job-cost reconciliation (Q3 2026).**
Layer 4. Requires ProService payroll integration. Closes the loop on
delivered margin. This is where the moat starts compounding.

**Phase 3 — Capacity-aware pricing intelligence (Q4 2026).**
Layers 3 + 5. Requires schedule data layer. Capacity forecast informs
pricing recommendations; segment-aware follow-up runs the cadence.

**Phase 4 — Cross-vertical expansion (2027).**
Beyond specialty construction. HVAC contractors first (different
service-line shape, same architecture). Then marketing agencies (proposal
generation; different document type but same orchestrator). Validates
the horizontal-entry / vertical-expansion strategy.

---

## 6. The AI Edge

### 6.1 Multi-agent architecture, not a GPT wrapper

The single most important architectural decision is decomposing the
problem into 8 narrow-responsibility agents. The contrast vs. a
GPT-wrapper approach:

| Aspect                    | GPT wrapper                          | This system                                  |
| ------------------------- | ------------------------------------ | -------------------------------------------- |
| Pricing accuracy          | LLM generates a price (hallucinable) | Tool call to real loaded-labor data          |
| Voice fidelity            | Generic LLM voice                    | Per-company voice patterns + boilerplate     |
| Exclusions enforcement    | Easy to forget                       | Required step in the state machine           |
| Margin truth              | Quoted-only                          | Closed-loop via payroll integration          |
| Insights                  | One-off prompts                      | Aggregated patterns over time                |

### 6.2 Tool-grounded numerics — the hallucination-resistance guarantee

The Pricing agent's behavior contract (spec §5.4):

> **NEVER generates labor or material cost numbers directly. Every
> numeric value traces to a tool call.**

In the code: `agents/pricing.py::compute_pricing` is deterministic
Python math over the outputs of `get_loaded_labor_cost`,
`lookup_material_cost`, `get_pricing_logic`, and
`get_capacity_utilization`. Only the narrative rationale is LLM-
generated, and the LLM is explicitly forbidden from changing numbers in
its system prompt.

Same pattern in JCR: math is deterministic; narrative is LLM.

### 6.3 Compounding context — the moat

Every completed job runs through the JCR agent. Delivered margin updates
`service_lines.typical_margin_pct`. Labor variance patterns update the
labor-hour formula on the next quote. The Intelligence agent watches
the rolling average and surfaces drift as actionable insights.

After 50 reconciled jobs, the system knows the contractor's real margin
per service line better than they do. After 200, it knows their labor
productivity by trade. None of this is replicable without payroll data —
which means none of it is replicable without being a PEO.

---

## 7. GTM Strategy

**Phase 1: Pilot launch (months 1-2).** 5-10 Hawaii pilot clients via
CSM warm intros. Free during pilot for outcome capture. Targets the
repeat-customer segment first because the value is more immediately
visible and the architecture's strongest features (JCR, capacity-aware
pricing, exclusions) hit that segment hardest.

**Phase 2: Paid conversion (month 3).** Convert pilots at the 60-day
mark. Pricing tiered $99 / $299 / $499. Cross-sell motion already
proven at ProService.

**Phase 3: ProService-wide rollout (months 4-9).** Sequence:
specialty construction (Cavy archetype) → HVAC → other PEO segments.
Each vertical only requires onboarding tuning, not architecture changes.

**Phase 4: Out-of-state expansion (months 9-18).** AdvanStaff Vegas and
Obsidian Denver once the contextual layer proves it generalizes.

**Why this works.** ProService has 3,000 captive Hawaii clients with
proven cross-sell motion. CAC is near-zero. Cyber insurance hit $1M ARR
in 6 months through the same channel; bid intelligence has higher AOV
potential because contractor value is more visible per dollar.

---

## 8. Risks and Open Questions

**Risk 1 — Data integration timing.** Phase 2 depends on ProService
payroll integration. Mitigation: Phase 1 ships standalone and delivers
real value; Phase 2 unlocks the moat but is not gated.

**Risk 2 — Pilot client recruitment.** Mitigation: Free pilot offer +
CSM warm intros eliminates most friction. Cavy already validated
willingness in discovery.

**Risk 3 — Pricing model unknowns.** Tiered approach is a hypothesis.
Pilot phase validates willingness to pay and which tier the value
delivery anchors at.

**Risk 4 — Cross-vertical fit.** Marketing agencies have structurally
different document patterns vs. construction. Mitigation: Architecture
is contextual — voice/scope/pricing tables are per-company, not
per-vertical. Validated by Archetype B + C in the demo data plan.

---

## Appendix A — Demo storyline (7.5 min)

Per spec §8.6:

1. **(90s)** Onboard new contractor. Drag 5-10 of Cavy's quotes. Watch
   Context extract service lines, voice, exclusions templates.
2. **(90s)** Generate bid for new scope (drawings + scope email). All 4
   generation agents fire. Pricing citation visible, capacity context
   visible.
3. **(60s)** Composition catches missing exclusion ("Rough grade should
   not be above final grade height"); prompts contractor. Accepts.
   Transitions DRAFT_GENERATED.
4. **(60s)** Mark bid SENT. Follow-up recognizes repeat_customer,
   schedules single soft 5-day touch in voice.
5. **(90s)** Open JCR view on completed job. Quoted vs actual variance,
   delivered margin, variance pattern alert.
6. **(90s)** Open Intelligence dashboard. 3 capacity-aware insights:
   pricing tension, margin trend, exclusions enforcement. Each with
   projected impact.
7. **(60s)** Architecture diagram. Walk through 8 agents. Explicit "this
   is not a GPT wrapper" frame.

---

## Appendix B — Data layer summary

15 tables per spec §4. Notable v2 additions:

- `service_lines` (promoted from sub-field) — each line has its own
  scope template, exclusions, pricing range
- `schedule_allocations` — feeds capacity-aware pricing
- `job_cost_reconciliation` — quoted vs actual, populated post-completion
- `bids.exclusions_applied` and `bids.exclusions_missing` — capture
  what Composition's verification step found
- `bids.capacity_at_quote` — retrospective: what was utilization when
  this was quoted?

All vectors stored in `pgvector` 1536-dim columns. Document storage is
local for PoC; S3 on production.
