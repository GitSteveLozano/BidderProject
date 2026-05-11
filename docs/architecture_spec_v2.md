ProService Bid Intelligence
Architecture Specification — v2.0
8-agent multi-agent system | 5-layer product | Option C framing
Prepared by Steve Lozano
ProService Hawaii — EIR Case Exercise
May 2026

Change Log — v1.0 → v2.0
Five changes from v1.0, all driven by customer discovery with Cavy at L&A Stucco. Architecture is unchanged; framing, agent responsibilities, and demo data have sharpened.
Strategic framing shifts from ‘help SMBs win more bids’ to ‘operating intelligence for specialty contractors.’ The case prompt is answered literally in the demo; the brief expands the framing based on what discovery revealed.
Composition agent gains an exclusions enforcement responsibility — verifies the draft includes the company’s standard exclusions for the service line before marking DRAFT_GENERATED.
Layer 4 reframes from Win/Loss Tracking to Job-Cost Reconciliation. The agent still captures won/lost outcomes for the cold-bid use case, but its primary purpose is comparing quoted price to actual delivered cost via ProService payroll data.
Intelligence agent gains capacity-awareness. New data input: scheduled work over next 8-12 weeks. New output: pricing recommendations calibrated by current schedule utilization.
Demo data switches from synthetic Hawaii contractor to Cavy’s real L&A Stucco corpus, transplanted to a Hawaii operating context. Real voice patterns, real exclusions, real service-line taxonomy, real pricing range. Payroll data simulated with Hawaii-burden numbers.

Contents
Change Log — v1.0 → v2.0
1. System Overview
2. Strategic Frame & Design Principles
3. The Discovery Insight
4. Data Layer — Schemas
5. Agent Specifications (8 agents)
6. Orchestrator State Model
7. Layer-by-Layer Data Flows (5 layers)
8. Demo Data Plan — Cavy / L&A Stucco
9. Build Sequence (7 days)
10. Brief Structure
11. Risk Register
12. Stack & Operational Decisions

1. System Overview
1.1 What this system is
ProService Bid Intelligence is a multi-agent AI platform that helps SMB specialty contractors operate more effectively. The system spans the full bid lifecycle — from RFP/scope intake through job-cost reconciliation — and gets measurably smarter with every bid and every completed job.
It is structurally not a GPT wrapper. The architecture is eight specialized agents, each owning a narrow responsibility, coordinated by an orchestrator over a shared context store. Each agent uses the model best suited to its task. The Pricing agent is hallucination-resistant by design — it queries real loaded labor data via tool calls rather than generating numbers. The Composition agent focuses on producing output in the company’s voice and verifies that standard exclusions are present. The Intelligence agent operates across all other agents’ outputs to surface capacity-aware insights only the system can produce.
1.2 The five product layers
The system delivers five layers of value, each enabled by a specific subset of the eight agents.
Layer 1 — Contextual Onboarding. Ingests a company’s past quotes and learns voice, service-line taxonomy, scope language, exclusions templates, and pricing patterns. Owned by Intake + Context agents.
Layer 2 — Bid Generation. Takes a scope description or input artifact (drawings, email, formal RFP) and produces a polished, accurately-priced quote in the company’s voice — with exclusions enforced. Owned by Intake + Context + Pricing + Composition agents.
Layer 3 — Follow-up Automation. Manages post-send lifecycle. Schedules and drafts follow-up touches based on company-specific cadence. Owned by Follow-up agent. (De-emphasized for repeat-customer contractors; load-bearing for cold-bidding ones.)
Layer 4 — Job-Cost Reconciliation. Compares quoted price to actual delivered cost via ProService payroll data. Surfaces real margin per job, per service line, per client type. Owned by Job-Cost Reconciliation agent (Win/Loss subsumed).
Layer 5 — Capacity-Aware Pricing & Operating Intelligence. Cross-cutting analytics. Combines win/loss patterns, delivered margin trends, and forward schedule utilization to recommend pricing for new bids. Owned by Intelligence agent (meta).
1.3 The eight agents
Each agent owns one narrow concern.
Orchestrator — routes workflows, manages bid state, merges outputs.
Intake — document understanding (RFPs, drawings, scope emails, change requests).
Context — owns the company profile; voice, service lines, scope patterns, exclusions, pricing logic, history.
Pricing — calibrated price recommendations using real loaded labor data via tool calls + capacity awareness.
Composition — generates bid documents in the company’s voice; verifies standard exclusions present.
Job-Cost Reconciliation — closes the loop between quoted price and actual delivered cost; tracks outcomes.
Follow-up — manages post-send lifecycle for bids that require it.
Intelligence — meta-agent; cross-agent synthesis; produces operating-intelligence-level insights including capacity-aware pricing recommendations.
1.4 Architecture diagram
                       ┌─────────────────────────────────┐
                       │   INTELLIGENCE AGENT          │  (meta, async)
                       │   capacity-aware synthesis    │
                       └──────────────────┐───────────────┘
                                          │ reads
                       ┌──────────────────▼───────────────┐
                       │         ORCHESTRATOR          │
                       │    state machine + routing    │
                       └─┬─────┬─────┬─────┬─────┬─────┬──┘
                         │     │     │     │     │     │
                  ┌─────┘──┐┌─────┘ ┌─────┘ ┌─────┘ ┌─────┘ ┌─────┘
                  │ INTAKE ││ CONTEXT│ │PRICING│ │ COMP. │ │ JCR  │ │ F-UP │
                  └──────┬─┘└───┬───┘ └──┬───┘ └──┬───┘ └──┬──┘ └──┬──┘
                         │        │           │         │        │        │
                         └────────┼──────────┼────────┼────────┼────────┘
                                  │           │         │        │
                                  ▼           ▼         ▼        ▼
                       ┌───────────────────────────────────┐
                       │     SHARED CONTEXT STORE      │
                       │  (Postgres + pgvector + S3)   │
                       │  Companies  Bids  Outcomes    │
                       │  Voice  Pricing  Payroll(sim) │
                       │  Service-lines  Schedule      │
                       └───────────────────────────────────┘
 
  Tool: Pricing agent calls get_loaded_labor_cost(trade, hours)
  Tool: Pricing agent calls get_capacity_utilization(window_weeks)
  Tool: Composition agent calls verify_exclusions(draft, service_line, company_id)
  Tool: Intake agent calls extract_pdf(document_id)
  Tool: JCR agent calls get_actual_labor_hours(job_id) [via payroll integration]
1.5 What makes this not a GPT wrapper
Specialization — each agent uses the model and prompting suited to its task. Intake uses an extraction-tuned model with construction-document few-shots. Composition uses a strong generation model with company voice context, plus a verification step for exclusions. Pricing uses tool calls, not generation.
Tool-grounded numerics — the Pricing agent cannot hallucinate labor cost because it does not generate it. It calls a function that returns real loaded payroll data. Same for capacity-utilization figures.
Closed-loop intelligence — the Job-Cost Reconciliation agent compares what was quoted to what the job actually cost via ProService payroll. Every completed job updates the company’s real-margin profile, which feeds back into the next bid’s Pricing agent. This is the moat that compounds and that no GPT wrapper can replicate.

2. Strategic Frame & Design Principles
2.1 Product strategy
Horizontal entry, vertical expansion. The system enters the market as a context-aware platform that adapts to any specialty contractor’s document patterns, service-line taxonomy, and pricing logic. Over time, vertical-specific depth accretes — specialty construction first (Cavy’s shape), then HVAC, then expanding ProService’s wider client base.
This resolves the prompt’s ambiguity. Marketing agencies, HVAC contractors, and small construction firms have structurally different bid documents. A vertical-specific tool fits 20% of ProService’s 3,000 employer base; a generic tool fits none of them well. A context-aware architecture fits all of them, with quality gated by how good each company’s records are.
2.2 Why ProService specifically
Three structural advantages no competitor can replicate:
Loaded labor cost data. ProService runs payroll for these companies. The Pricing agent has access to actual fully-burdened labor rates per worker per trade — including workers comp burden by NCCI class code, benefits, OT calculations, and Hawaii-specific items (PHCA-mandated health, TDI, prevailing wage where applicable). No competitor has this. Procore doesn’t. ServiceTitan doesn’t. ChatGPT certainly doesn’t.
Job-cost reconciliation via payroll. Because ProService also captures actual labor hours per job (via payroll allocations), the system can close the loop between quoted price and delivered margin. This is the Job-Cost Reconciliation agent’s function and it is unreplicable without becoming a PEO.
Distribution at near-zero CAC. 3,000 Hawaii employer clients, existing CSM relationships, proven cross-sell motion (cyber insurance reached $1M ARR in six months). The product launches into a captive, trusting audience.
2.3 Design principles
Principle 1: One responsibility per agent
Each agent owns a single, narrow concern. No agent does extraction AND retrieval AND generation. The orchestrator coordinates; agents specialize.
Principle 2: Tool calls over generation for numerics
Anywhere a number determines real-world money, the system calls a tool that returns the number. The Pricing agent does not generate labor costs or capacity utilization. The Job-Cost Reconciliation agent does not generate actual hours. They query.
Principle 3: Visible state transitions
The orchestrator’s state machine is observable. Every bid has a current state, a history of transitions, and the agent calls that produced each transition. The demo UI exposes this directly.
Principle 4: Async meta over sync coordination
Cross-cutting analysis (Intelligence agent, Job-Cost Reconciliation pattern detection) runs asynchronously on aggregated state, not in the hot path of bid generation.
Principle 5: Graceful degradation
Each agent produces useful output even when its inputs are partial. The Composition agent generates a competent bid even with one past quote. The Pricing agent returns a price range with a wide confidence interval when labor data is partial.
Principle 6: Exclusions are first-class
New for v2. Standard exclusions in a specialty contractor’s quote aren’t boilerplate — they’re institutionalized lessons that protect margin. Missing an exclusion costs real money. The Composition agent treats exclusions verification as a required step, not an afterthought.

3. The Discovery Insight
This section captures what customer discovery surfaced and why it shapes the product. It is referenced directly in the brief’s Customer Discovery section.
3.1 The two SMB contractor segments
Discovery interviews revealed two structurally different SMB contractor business models, with different bottlenecks:
Repeat-customer relationship-driven (Cavy at L&A Stucco, ~95% repeat clients). Bottleneck is administrative throughput, pricing discipline against schedule, and exclusions consistency. NOT winning.
Cold-bidding lead-driven. Bottleneck is conversion rate, follow-up cadence, and win/loss intelligence. Average win rate per Level CFO data: 5–10%. Top performers: 70–85%.
3.2 What Cavy told us
‘Our formal bidding process is simply estimates. Because we mainly do B2B and 95% repeat customers, it’s rare that we have to convince them to use us. Mainly comes down to price but even that is negotiable.’
‘Win rate is really subjective because we are pretty much held to supply and demand. If we need the work to fill a schedule then we lower our price to get it.’
‘25 to 40%.’ (Typical margin range, flexes by schedule)
‘Competitors. EIFS: inex plastering, metro plastering, Eco exteriors. Siding: Red River siding, Eco exteriors. Stucco: metro plastering, dels exteriors.’
3.3 Implications for the product
Cavy’s pattern is broadly representative of repeat-customer SMB contractors — the segment ProService’s clients largely fall into. Four specific problems emerge:
Quote velocity and consistency. Cavy produces ~1.4 quotes per month at wildly varying complexity ($2K patches to $1.18M EIFS). Each one takes real time. Doubling velocity at same staff captures more opportunity flow.
Pricing discipline against capacity. He discounts to fill schedule, but reactively. A system that knows his actual cost basis, current schedule utilization, and pipeline could institutionalize this pricing logic and quantify the margin tradeoff before he discounts.
Exclusions enforcement. His exclusions lists are templated and consistent — because they protect margin. Missing one creates scope creep risk. AI can enforce them across every quote.
Real margin tracking. ‘25 to 40%’ is a wide band. Without payroll-integrated job-cost reconciliation, he likely doesn’t know his actual delivered margin per service line. ProService can show him.
3.4 How the architecture handles both segments
The 8-agent architecture supports both segments without rebuilding. For repeat-customer contractors, Layer 4 (Job-Cost Reconciliation) and Layer 5 (Capacity-Aware Intelligence) are the load-bearing value. For cold-bidding contractors, Layer 3 (Follow-up Automation) and the win/loss tracking subset of Layer 4 are the load-bearing value. The Composition agent’s exclusions enforcement matters for both. The Pricing agent’s tool-grounded numerics matter for both.
The case demo leads with the bid generator the prompt asked for. The brief expands the framing based on what discovery revealed and shows how the same architecture serves both segments.

4. Data Layer — Schemas
All data lives in Postgres with pgvector for embeddings and S3 for raw document storage. Schemas below define the shared context store.
4.1 companies
companies {
  id                  uuid (pk)
  proservice_client_id text
  name                text
  dba                 text nullable
  primary_trade       text
  secondary_trades    text[]
  service_area        jsonb
  size_band           text
  annual_revenue_band text
  years_in_business   int
  vertical_template   text
  segment             text  // 'repeat_customer' | 'cold_bidding' | 'mixed'
  created_at, updated_at
}
4.2 voice_patterns
voice_patterns {
  id                       uuid (pk)
  company_id               uuid (fk)
  tone                     text
  avg_sentence_length      int
  preferred_terms          jsonb
  avoided_terms            text[]
  boilerplate_intro        text
  boilerplate_scope_intro  text
  boilerplate_terms        text
  boilerplate_warranty     text
  boilerplate_closing      text
  formatting               jsonb
  voice_embedding          vector(1536)
  source_document_ids      uuid[]
  last_extracted_at
}
4.3 service_lines (NEW — promoted from scope_patterns sub-field)
In v1.0 service lines were a sub-field in scope_patterns. Cavy’s corpus showed they’re first-class — each line has its own scope template, exclusions, pricing logic, and typical price range.
service_lines {
  id                       uuid (pk)
  company_id               uuid (fk)
  line_name                text  // 'STUCCO-CONVENTIONAL', 'EIFS', 'Siding', ...
  typical_scope_text       text
  standard_exclusions      text[]
  pricing_unit             text  // 'lump_sum' | 'per_sqft' | 'per_lf' | 'hourly'
  pricing_range_residential jsonb // {low, mid, high}
  pricing_range_commercial jsonb
  typical_margin_pct       decimal
  manufacturers_referenced text[]  // ADEX, James Hardie, Gentek, LUX, ...
  last_extracted_at
}
4.4 pricing_logic
pricing_logic {
  id                          uuid (pk)
  company_id                  uuid (fk)
  default_labor_markup_pct    decimal
  default_material_markup_pct decimal
  overhead_pct                decimal
  target_margin_pct           decimal
  margin_range_low_pct        decimal  // NEW: Cavy = 25%
  margin_range_high_pct       decimal  // NEW: Cavy = 40%
  capacity_discount_behavior  text  // 'flex_by_schedule' | 'fixed'  NEW
  minimum_bid_threshold       decimal
  payment_terms_default       text
  deposit_pct                 decimal
  pricing_by_service_line     jsonb
  last_recomputed_at
}
4.5 scope_patterns
Now slimmer — most content moved to service_lines. Holds cross-cutting patterns.
scope_patterns {
  id                    uuid (pk)
  company_id            uuid (fk)
  typical_inclusions    text[]
  typical_assumptions   text[]
  addenda_patterns      text[]
  upgrade_patterns      text[]  // Cavy uses '$0.00 line items' for optional upgrades
  last_extracted_at
}
4.6 bids
bids {
  id                       uuid (pk)
  company_id               uuid (fk)
  source_input_doc_id      uuid (fk → documents) nullable
  state                    text
  service_line             text  // NEW: references service_lines.line_name
  job_type                 text
  client_name              text
  client_segment           text  // 'repeat' | 'new' | 'cold_lead'  NEW
  job_address              jsonb
  scope_summary            text
  estimated_value          decimal
  estimated_labor_hours    int     // NEW: feeds capacity calculation
  estimated_start_date     date    // NEW: feeds capacity calculation
  estimated_duration_days  int     // NEW
  bid_deadline             timestamp
  draft_document_id        uuid
  sent_document_id         uuid nullable
  pricing_breakdown        jsonb
  exclusions_applied       text[]  // NEW: which exclusions Composition verified present
  capacity_at_quote        decimal // NEW: % utilization when quoted (for retrospective)
  created_at, draft_generated_at, sent_at, outcome_captured_at
  outcome                  text
  outcome_reason           text
  outcome_competitor       text
  outcome_winning_bid      decimal
  actual_labor_hours       int     // NEW: populated by JCR agent post-completion
  actual_cost_total        decimal // NEW: populated by JCR
  delivered_margin_pct     decimal // NEW: populated by JCR
}
4.7 bid_state_history
bid_state_history {
  id              uuid (pk)
  bid_id          uuid (fk)
  from_state      text
  to_state        text
  triggered_by    text
  agent_call_id   uuid nullable
  notes           text
  occurred_at     timestamp
}
4.8 follow_ups
follow_ups {
  id                  uuid (pk)
  bid_id              uuid (fk)
  sequence_number     int
  scheduled_for       timestamp
  state               text
  channel             text
  draft_message       text
  sent_at             timestamp nullable
  response_received   bool
  response_summary    text
}
4.9 documents
documents {
  id                 uuid (pk)
  company_id         uuid (fk) nullable
  type               text  // 'past_quote' | 'rfp' | 'drawings' | 'change_request'
                          // | 'scope_email' | 'completed_job' | 'generated_bid'
                          // | 'follow_up_message'
  filename           text
  s3_key             text
  raw_text           text
  structured_data    jsonb
  embedding          vector(1536)
  uploaded_at
}
4.10 employees (simulated payroll layer)
employees {
  id                       uuid (pk)
  company_id               uuid (fk)
  name                     text
  trade_classification     text
  ncci_class_code          text
  base_hourly_rate         decimal
  ot_multiplier            decimal
  apprentice_level         text nullable
  is_prevailing_wage_only  bool
  status                   text
  hire_date                date
}
4.11 burden_components (simulated)
burden_components {
  id                         uuid (pk)
  employee_id                uuid (fk)
  effective_date             date
  fica_pct                   decimal
  futa_pct                   decimal
  suta_pct                   decimal
  workers_comp_rate_per_100  decimal
  experience_mod_factor      decimal
  phca_health_monthly        decimal
  tdi_employer_weekly        decimal
  retirement_match_pct       decimal
  pto_accrual_hours_yr       int
  training_annual            decimal
  other_benefits_monthly     decimal
  total_burden_pct           decimal
  loaded_hourly_rate         decimal
}
4.12 schedule_allocations (NEW)
Feeds capacity-aware pricing. Records confirmed work assignments per employee per week.
schedule_allocations {
  id                  uuid (pk)
  employee_id         uuid (fk)
  bid_id              uuid (fk)  // the won bid this allocation supports
  week_start_date     date
  allocated_hours     int
  trade_role          text
  created_at
}
 
  // Aggregated by Pricing agent at quote time:
  // get_capacity_utilization(week_window) returns
  // {week_28: 0.82, week_29: 0.74, week_30: 0.40, ...}
4.13 prevailing_wages (Hawaii)
prevailing_wages {
  id              uuid (pk)
  trade           text
  county          text
  basic_hourly    decimal
  fringe_hourly   decimal
  total_hourly    decimal
  effective_date  date
  bulletin_number text
}
4.14 job_cost_reconciliation (NEW)
Post-completion data populated by Job-Cost Reconciliation agent.
job_cost_reconciliation {
  id                       uuid (pk)
  bid_id                   uuid (fk)
  company_id               uuid (fk)
  quoted_price             decimal
  quoted_labor_hours       int
  quoted_labor_cost        decimal
  quoted_material_cost     decimal
  quoted_margin_pct        decimal
  actual_labor_hours       int  // from payroll allocations
  actual_labor_cost        decimal  // hours * loaded_rate
  actual_material_cost     decimal  // user-entered or invoiced
  actual_other_costs       decimal
  delivered_margin_pct     decimal
  variance_labor_hours_pct decimal
  variance_total_cost_pct  decimal
  notes                    text
  reconciled_at            timestamp
}
4.15 intelligence_insights
intelligence_insights {
  id                 uuid (pk)
  company_id         uuid (fk)
  generated_at       timestamp
  category           text  // 'pricing' | 'capacity' | 'margin' | 'competitor'
                          // | 'follow_up' | 'exclusions'  NEW: capacity
  severity           text
  headline           text
  finding            text
  recommendation     text
  projected_impact   text
  supporting_bids    uuid[]
  status             text
}

5. Agent Specifications
Each agent’s contract. Implementations in agents/<name>.py implement the contract; the orchestrator calls the public function and consumes structured output.
5.1 Orchestrator
Purpose
Decompose user intent into a workflow; route between agents; manage bid state; merge agent outputs.
Inputs
User action OR timer trigger.
Outputs
State transitions written to bid_state_history; agent invocations; final response payload.
Model
Claude Haiku 4.5 for routing; rule-based for state transitions.
Tools
All agent invocation functions; database write access; timer/queue access.
State
Stateful per bid via bid_state_history.
Latency target
Routing decision <500ms; full generation flow <30s.
5.2 Intake Agent
Purpose
Parse uploaded documents (RFPs, drawings, scope emails, change requests, past quotes) into structured data.
Inputs
document_id + document_type hint. Supports image-based drawings via vision.
Outputs
Structured JSON: {client_info, scope_items, service_line_hint, deadline, addenda, document_classification, confidence_score}.
Model
Claude Haiku 4.5 with construction-document few-shots; Sonnet fallback for ambiguous documents.
Tools
extract_pdf_text, extract_pdf_images, classify_document.
State
Stateless.
Latency target
<5s per document.
Behavior contract: Output is always valid JSON. Below confidence threshold (<0.7), flag for human review with structured manual-entry fallback. NEW for v2: handles ‘drawings + scope email’ inputs since this is how repeat-customer contractors like Cavy actually receive work.
5.3 Context Agent
Purpose
Owns company profile. Answers questions about voice, service lines, scope language, exclusions, pricing logic, history.
Inputs
company_id + query.
Outputs
Synthesized answer with traceability to source documents.
Model
Claude Sonnet 4 for synthesis. text-embedding-3-small for retrieval.
Tools
vector_search, get_voice_patterns, get_service_lines, get_pricing_logic, get_scope_patterns, get_recent_jobs.
State
Reads from voice_patterns, service_lines, pricing_logic, scope_patterns.
Latency target
<3s per query.
Behavior contract: When source documents are fewer than 3, declares low confidence and Composition agent surfaces ‘calibrating’ messaging in UI. NEW for v2: service_lines is its own retrieval target — the agent can answer ‘what are this company’s standard exclusions for EIFS?’ distinct from ‘what are their stucco-conventional exclusions?’
5.4 Pricing Agent
Purpose
Produce calibrated price recommendation with full breakdown, confidence interval, AND capacity-aware modifier.
Inputs
scope_items, service_line, company_id, estimated_start_date.
Outputs
Pricing breakdown: {labor: {hours_by_trade, loaded_rates, subtotal}, materials, overhead, profit, target_price, range_low, range_high, capacity_utilization_at_start, capacity_modifier, win_rate_estimate, citations}.
Model
Sonnet 4 for narrative rationale; deterministic calculation logic for numbers.
Tools
get_loaded_labor_cost, lookup_material_cost, get_pricing_logic, get_win_rate_at_price, get_capacity_utilization(weeks). NEW for v2: capacity tool.
State
Stateless. All numbers come from tool calls.
Latency target
<8s including all tool calls.
Behavior contract: NEVER generates labor or material cost numbers directly. Every numeric value traces to a tool call. NEW for v2: produces a ‘capacity_modifier’ — a recommendation to hold price (when utilization is high) or consider discount (when utilization is low). The narrative rationale explains the modifier; the underlying utilization data is queried.
Sample output narrative the Pricing agent produces:
‘Recommended target price: $48,200 (range $44,000–$52,500). Labor: 312 hours across stucco team (5403). At loaded rate $48.20/hr, labor subtotal $15,038. Materials estimated at $12,400 based on ADEX system spec. Overhead 18% standard, target margin 32%. Capacity note: scheduled at 84% utilization for week of estimated start. Recommend holding firm at target price — you do not need to discount to fill this slot.’
5.5 Composition Agent
Purpose
Generate customer-facing bid document in voice. NEW for v2: verify standard exclusions present before marking DRAFT_GENERATED.
Inputs
structured intake + company profile + pricing breakdown + service_line.
Outputs
Complete bid document (markdown + structured sections) + exclusions_verified flag + exclusions_missing list.
Model
Claude Sonnet 4. System prompt loaded with company voice samples + service-line scope template + exclusions checklist.
Tools
render_template, get_boilerplate, verify_exclusions(draft, service_line, company_id). NEW for v2: verify_exclusions tool.
State
Stateless per call.
Latency target
<10s per bid including exclusions verification.
Behavior contract: Does not modify pricing numbers. NEW for v2: at end of generation, calls verify_exclusions which checks the draft for each standard exclusion in the company’s service_line.standard_exclusions list. If any are missing, the agent surfaces them as exclusions_missing and the UI prompts: ‘Your stucco-conventional quotes typically exclude ‘Rough grade should not be above final grade height.’ Add to this quote?’ Human approves or skips before SENT transition.
5.6 Job-Cost Reconciliation Agent (NEW for v2 — replaces Win/Loss)
Purpose
Close the loop between quoted price and actual delivered cost. Compute real margin. Detect patterns over time.
Inputs
bid_id (state WON or job complete) + actual labor hours via payroll integration + material costs (user-entered or invoiced).
Outputs
job_cost_reconciliation row + updated bids.delivered_margin_pct + pattern detection writeback to service_lines.typical_margin_pct.
Model
Sonnet 4 for pattern synthesis (nightly batch); deterministic for reconciliation math.
Tools
get_actual_labor_hours(bid_id), get_payroll_period_data(date_range), get_bid_history.
State
Async. Triggered on outcome capture (WON) and on job completion.
Latency target
Reconciliation <3s per job; nightly pattern detection <60s per company.
Behavior contract: Distinguishes between WON (bid accepted, work pending) and COMPLETE (work delivered, costs known). Reconciliation runs at COMPLETE state. Pattern claims require n>=8 completed jobs in a service line. NEW for v2: subsumes the v1 Win/Loss agent’s functions for cold-bid contractors who care about win rate.
Sample reconciliation output:
‘Job: 750 London st (Quote #5319, $96,000). Quoted: 480 labor hours at avg loaded rate $51.20 ($24,576 labor), $34,200 materials, target margin 35.7%. Actual: 542 labor hours via payroll ($27,750 labor cost), $36,100 materials, total cost $63,850. Delivered margin: 33.5%. Variance: labor hours +12.9%, total cost +6.1%. Pattern alert: 3 of last 4 siding jobs ran 10-15% over labor hour estimates. Consider updating siding labor hour formula by +12%.’
5.7 Follow-up Agent
Purpose
Manage post-send lifecycle. Schedule follow-up touches; draft messages in voice; detect cold bids.
Inputs
bid_id (state SENT) + company’s historical follow-up patterns + client_segment.
Outputs
Scheduled follow-ups in follow_ups table; drafted messages; cold-bid alerts.
Model
Sonnet 4 for message drafting; rule-based for scheduling cadence.
Tools
get_optimal_cadence, compose_followup.
State
Stateful per bid.
Latency target
Draft generation <5s.
Behavior contract: Default cadence 48hr / 5d / 10d when no history. NEW for v2: if company segment is ‘repeat_customer’, defaults to single soft follow-up at 5d only (per Cavy’s pattern — over-following-up with repeat clients damages relationships). For ‘cold_bidding’ or ‘new’ client_segment, runs the full 3-touch sequence.
5.8 Intelligence Agent (meta, v2 sharper)
Purpose
Cross-cutting synthesis. NEW for v2: combines win/loss patterns, delivered-margin trends, AND capacity utilization to produce capacity-aware operating intelligence.
Inputs
company_id (full state across all other agents’ outputs).
Outputs
Insights written to intelligence_insights. Each has headline, finding, recommendation, projected impact, supporting bid IDs.
Model
Claude Sonnet 4 with extended context.
Tools
Read access to all data tables. compute_margin_trend, compute_capacity_utilization_forecast, compute_competitor_loss_pattern, compute_followup_correlation, project_impact.
State
Async / batch. Weekly per company; on-demand.
Latency target
Full analysis <60s per company.
Behavior contract: Insights surface only when n>=15 supporting bids and effect size above noise floor. Each insight has traceable evidence trail. Recommendations are hypotheses with projected impact.
Sample insight outputs the agent produces:
‘Capacity: scheduled at 84% utilization for weeks 28-30. Three open quotes total $312K. The Esprit Heights ph2 quote at $175,400 (29% target margin) is your highest-value open opportunity. Recommend holding firm — schedule supports it. Projected impact: ~$8,200 retained margin vs. typical 5% schedule-discount.’
‘Margin: delivered margin on EIFS jobs trended from 32% (Q4) to 26% (Q1). 3 of 4 EIFS jobs ran labor hours 12–18% over quote. Pattern suggests labor productivity assumptions for ADEX-system installs need recalibration. Recommend +12% labor hour buffer on next 3 EIFS quotes; measure outcomes; adjust formula.’
‘Exclusions: 2 of last 8 stucco-conventional quotes were missing ‘Rough grade above final grade’ exclusion. Both led to scope creep on those jobs (variance +18% and +22%). Composition agent now auto-flags this exclusion; recommend enforcing.’

6. Orchestrator State Model
Bid state machine — mostly unchanged from v1.0, plus new states for job-cost reconciliation.
6.1 States
RFP_RECEIVED
Input received. Intake not yet run.
ASSESSING
Orchestrator routing through Context + Pricing + Composition.
DRAFT_GENERATED
Composition complete. Bid draft ready. Exclusions verified.
EXCLUSIONS_REVIEW
NEW v2. Composition found missing exclusions; awaiting human decision.
HUMAN_REVIEW
Awaiting contractor review and edits.
SENT
Bid delivered to prospect. Follow-up sequence scheduled (segment-aware).
FOLLOW_UP_*_DUE/SENT
Follow-up lifecycle (varies by client_segment).
REVISED
Scope change received. Looping back through ASSESSING.
WON
Outcome captured. Job pending.
JOB_IN_PROGRESS
NEW v2. Work started; payroll allocations being captured.
JOB_COMPLETE
NEW v2. Work delivered. Triggers Job-Cost Reconciliation.
RECONCILED
NEW v2. JCR agent has computed delivered margin.
LOST
Outcome captured. Reason logged.
WITHDRAWN
Walked away pre-send.
STALLED
14+ days no response.
NO_DECISION
Explicitly told no decision yet.
6.2 Key transitions
RFP_RECEIVED       → ASSESSING            (auto)
ASSESSING          → DRAFT_GENERATED OR   (auto: Composition complete, all exclusions present)
                      EXCLUSIONS_REVIEW    (auto: Composition flagged missing exclusions)
EXCLUSIONS_REVIEW  → DRAFT_GENERATED      (human: accepts or skips flagged exclusions)
DRAFT_GENERATED    → HUMAN_REVIEW         (auto)
HUMAN_REVIEW       → SENT | REVISED | WITHDRAWN
SENT               → (segment-aware follow-up branch)
                   → WON | LOST | STALLED
WON                → JOB_IN_PROGRESS      (auto when start_date reached)
JOB_IN_PROGRESS    → JOB_COMPLETE         (human: marks complete)
JOB_COMPLETE       → RECONCILED           (auto: JCR agent computes margin)
STALLED            → LOST                 (timer: +30d total)
6.3 Agent invocation rules
ASSESSING transition fires Intake → Context → Pricing → Composition in sequence. Composition’s exclusions verification determines the next state.
SENT transition fires Follow-up agent with client_segment-aware cadence.
WON/LOST/STALLED outcomes fire JCR agent (sync writeback) and queue Intelligence agent for next batch.
JOB_COMPLETE fires JCR agent for full reconciliation; this is where delivered margin is computed.
Intelligence agent runs weekly by default; can be triggered on-demand from the UI.

7. Layer-by-Layer Data Flows
7.1 Layer 1 — Contextual Onboarding
1. UI: contractor uploads past quotes (Cavy: 10 documents)
2. Orchestrator: creates company row, queues each doc for Intake
3. Intake (per doc): extract structured data + raw text
4. Context agent: aggregates across documents
        → computes voice_patterns
        → extracts service_lines taxonomy (NEW for v2)
        → computes pricing_logic (margin_range_low_pct, margin_range_high_pct, capacity_discount_behavior)
        → computes scope_patterns
        → generates voice_embedding
5. Orchestrator: marks company onboarded
6. UI: displays profile + extracted service lines + exclusions templates
   contractor confirms/edits
Output for Cavy: 5 service lines extracted (STUCCO-CONVENTIONAL, STUCCO-textured acrylic, EIFS, Siding, METAL WORK), exclusions templates per line, margin range 25-40%, capacity_discount_behavior='flex_by_schedule'.
7.2 Layer 2 — Bid Generation
1. UI: contractor uploads scope (drawings, RFP, or scope email)
2. Orchestrator: creates bid in RFP_RECEIVED, transitions to ASSESSING
3. Intake agent: extracts scope_items, infers service_line
4. Context agent (parallel): pulls voice + service-line-specific scope template +
        standard exclusions for that service line
5. Pricing agent: maps scope to trades
        → calls get_loaded_labor_cost for each trade
        → calls get_capacity_utilization for estimated_start_date window (NEW)
        → calls get_pricing_logic for markups + margin target
        → returns target_price + capacity_modifier with full citation trail
6. Composition agent: generates bid in voice
        → calls verify_exclusions (NEW for v2)
        → if all standard exclusions present: writes DRAFT_GENERATED
        → if missing: state → EXCLUSIONS_REVIEW with list of missing
7. UI: renders bid with agent trail visible. If exclusions missing, prompts contractor
7.3 Layer 3 — Follow-up Automation (segment-aware)
1. Orchestrator: on SENT, reads bid.client_segment from Context
2. If segment = 'repeat_customer':
        → schedule single soft follow-up at +5d
        → Follow-up agent drafts in lighter, relationship-respecting voice
3. If segment = 'cold_bidding' or 'new':
        → schedule 3-touch sequence (48hr / 5d / 10d)
        → Follow-up agent drafts each touch in voice with escalating directness
4. Each touch: human reviews + sends (or auto-send if opted in)
7.4 Layer 4 — Job-Cost Reconciliation (NEW framing)
1. Outcome capture: contractor marks WON
   → Orchestrator captures outcome, cancels remaining follow-ups
   → Schedule allocations created for the winning quote
2. Job runs (real world)
3. Payroll cycles: actual labor hours flow into employees × schedule_allocations
4. Contractor marks JOB_COMPLETE
5. JCR agent (sync):
        → calls get_actual_labor_hours(bid_id) from payroll allocations
        → reads quoted_labor_hours from pricing_breakdown
        → computes delivered_margin_pct
        → writes job_cost_reconciliation row
        → updates bids.delivered_margin_pct
6. JCR agent (nightly batch, when n>=8 reconciled per service line):
        → detect labor hour variance patterns
        → detect material cost drift
        → update service_lines.typical_margin_pct
        → surface findings to Intelligence agent’s queue
7.5 Layer 5 — Capacity-Aware Operating Intelligence
1. Scheduler: triggers Intelligence agent weekly per company
2. Intelligence agent pulls:
        → win_loss_patterns (where applicable)
        → job_cost_reconciliation history
        → service_lines.typical_margin_pct trends
        → schedule_allocations forecast (next 12 weeks)
        → active bids in pipeline + their estimated_start_date
3. Synthesis:
        → compute capacity utilization forecast
        → cross-reference open quotes vs. forecast
        → identify pricing-tension situations (high quote + low utilization OR low quote + high utilization)
        → surface margin trend warnings
        → surface exclusions enforcement opportunities (NEW)
4. Writes prioritized insights to intelligence_insights
5. UI: dashboard surfaces top insights with severity + projected impact

8. Demo Data Plan — Cavy / L&A Stucco
Primary demo profile is built from Cavy’s real corpus at L&A Stucco (2010) Ltd., transplanted to a Hawaii operating context per Plan A. Real voice patterns, real exclusions, real service-line taxonomy, real pricing distribution. Payroll data simulated with Hawaii-burden numbers. Cavy has agreed to this use.
8.1 Archetype A — ‘Honolulu Stucco & Exteriors LLC’ (Cavy-derived, primary)
Profile basis: L&A Stucco (2010) Ltd., West St. Paul MB, transplanted to Honolulu.
Real elements (from Cavy): voice patterns, service line taxonomy, exclusions templates, pricing range distribution, 95% repeat-customer business model, capacity-discount behavior.
Simulated for Hawaii: address, payroll burden, GET (not GST), prevailing wage applicability, employee roster with Hawaii rates.
Service lines: STUCCO-CONVENTIONAL, STUCCO-textured acrylic, EIFS, Siding, METAL WORK, RESTUCCO, REPAIR, DEMOLITION.
Real quote corpus: 10 anonymized estimates ranging $2,467–$1,180,725 (median ~$36K).
Segment: repeat_customer (validated by Cavy).
Demo storyline: receives drawings + scope email from local GC for a multi-unit residential exterior package; system handles the end-to-end flow including capacity-aware pricing recommendation.
8.2 Archetype B — Specialty Millwork (Dale Sandwith / Vantage Millwork, secondary)
Pending corpus: 2-3 past quotes from Dale at Vantage.
Different shape than Cavy: line-item driven, per-linear-foot pricing, much more catalog-driven scope.
Demo segment: brief side-by-side showing the contextual layer adapting to a different business shape.
If Dale’s corpus doesn’t arrive in time, synthesize a millwork profile based on industry standard patterns.
8.3 Archetype C — Marketing Agency (tertiary, demoable not central)
Pending corpus: 1-2 past proposals from a Tiny Bison / Honolulu network agency.
Different document type: narrative proposal vs. itemized quote. Demonstrates cross-vertical architecture range.
Demo segment: 60 seconds of UI walkthrough showing the same orchestrator produces structurally different output.
8.4 Cavy’s outcome data — status: pending request
Requested from Cavy: outcomes on the 10 quotes (won/lost/stalled), delivered margin on closed ones, competitor names (provided: ‘Inex Plastering, Metro Plastering, Eco Exteriors’ for EIFS; ‘Red River Siding, Eco Exteriors’ for Siding; ‘Metro Plastering, Dels Exteriors’ for Stucco).
If outcomes data arrives: use real win/loss markers and margin numbers. Powerful demo material because everything traces to real bids by real client names.
If outcomes data does NOT arrive in time: synthesize plausible outcomes consistent with Cavy’s self-reported 25-40% margin range and competitor list. Document the assumption in the brief.
8.5 Simulated payroll dataset for Archetype A
Hawaii-burden numbers calibrated to BLS construction averages + Hawaii DLIR prevailing wage + NCCI workers comp rates. 8 employees across the trades Cavy’s services require.
Company: Honolulu Stucco & Exteriors LLC (8 employees)
 
ID  Name              Trade               NCCI  Base    Loaded   Burden
1   Lead Stucco Mech  lead_stucco_mech    5022  $46.00  $68.08   48.0%
2   Stucco Journ A    stucco_journeyman   5022  $38.00  $55.86   47.0%
3   Stucco Journ B    stucco_journeyman   5022  $38.00  $55.86   47.0%
4   EIFS Installer    eifs_installer      5022  $42.00  $61.74   47.0%
5   Sider Lead        siding_lead         5645  $36.00  $54.00   50.0%
6   Sider             siding_installer    5645  $30.00  $45.00   50.0%
7   Finisher          finisher            5022  $32.00  $46.72   46.0%
8   Helper            general_laborer     5606  $22.00  $31.46   43.0%
 
Burden breakdown (Lead Stucco Mech, $46/hr base):
  FICA (7.65%)                  $3.52
  FUTA (0.6% on first $7K)      $0.04
  SUTA (Hawaii 2.4%)            $1.10
  Workers Comp (5022 @ $9.80/$100) $4.51
  PHCA Health (employer share)  $5.20/hr equivalent
  TDI (Hawaii employer)         $0.18
  Retirement match (3%)         $1.38
  PTO accrual                   $1.77
  Training                      $0.22
  Loaded total                  $68.08 (48.0% burden)
 
Schedule allocations (weeks 28-32 to feed capacity-aware demo):
  Week 28: 78% utilization (most employees on Esprit Heights ph2 mock)
  Week 29: 84% utilization (continuing + new SNR mock)
  Week 30: 84% utilization
  Week 31: 62% utilization (mid-month gap)
  Week 32: 41% utilization (open weeks)
8.6 Demo flow timing (revised for Option C)
Segment 1 (90s)
Onboard new contractor. Drag 5-10 of Cavy’s real quotes. Show Context agent extracting service lines, voice, exclusions templates.
Segment 2 (90s)
Generate bid for new scope (drawings + scope email). Show all 4 generation agents firing. Pricing citation visible, capacity context visible.
Segment 3 (60s)
Composition agent catches missing exclusion (‘Rough grade should not be above final grade height’); prompts contractor. Contractor accepts. State transitions DRAFT_GENERATED.
Segment 4 (60s)
Mark bid SENT. Follow-up agent recognizes repeat_customer segment, schedules single soft 5-day touch in voice.
Segment 5 (90s)
Open Job-Cost Reconciliation view on completed job. Show quoted vs. actual variance, delivered margin, variance pattern alert.
Segment 6 (90s)
Open Intelligence dashboard. Show 3 capacity-aware insights: pricing tension, margin trend, exclusions enforcement. Each with projected impact.
Segment 7 (60s)
Architecture diagram. Walk through 8 agents. Explicit ‘this is not a GPT wrapper’ frame.
Total
~7.5 minutes

9. Build Sequence (7 days)
Same overall shape as v1.0 with v2 updates to which work happens which day.
Day 0 (today) — Spec lock + setup + ingestion start
Lock this spec (v2).
Set up repo, Postgres + pgvector, FastAPI scaffold.
Generate Anthropic API key, test Sonnet 4 + Haiku 4.5 calls.
Ingest Cavy’s 10 real quotes into /data/raw/. Pre-extract text. Manually verify.
Draft Cavy follow-up: outcomes on the 10 quotes, delivered margin where known.
Day 1 — Discovery + corpus completion
3-5 more discovery calls (Dale, 2-3 from Rolodex, 1 marketing agency).
Collect 2-3 more contractor corpora to supplement Cavy’s.
Validate per call: (1) frequency of bidding, (2) what they’d pay for capacity-aware pricing, (3) where time goes during a bid week, (4) repeat vs. new customer mix.
End of day: enriched corpus, validation data for brief’s discovery section.
Day 2 — Foundation
Database schemas implemented (sections 4.1-4.15). NEW v2: service_lines, schedule_allocations, job_cost_reconciliation.
Orchestrator skeleton with state machine.
Intake agent: end-to-end. PDF → structured JSON. Tested on Cavy’s quotes (treated as input documents in reverse) + sample scope emails.
Documents table populated with Cavy’s corpus, embeddings generated.
End of day: real corpus ingested, Intake agent working on real artifacts.
Day 3 — Context + Composition (with exclusions)
Context agent: voice extraction, service-line taxonomy extraction (NEW), pricing logic extraction, exclusions template extraction.
Populate voice_patterns + service_lines + pricing_logic + scope_patterns for Archetype A.
Composition agent: voice-fidelity generation + verify_exclusions tool implementation.
End of day: RFP-in, draft-bid-out for Archetype A. Demo of exclusions enforcement works.
Day 4 — Pricing + simulated payroll + capacity
Simulated payroll data populated for Archetype A.
Pricing agent tools: get_loaded_labor_cost, lookup_material_cost, get_pricing_logic, get_capacity_utilization (NEW).
schedule_allocations table seeded with 12 weeks of forecast data.
Wire Pricing into bid generation flow with capacity-aware modifier.
Citation/transparency UI: show every number traces to a tool call.
End of day: bid generation produces real-feeling pricing with capacity citation trail.
Day 5 — Job-Cost Reconciliation + Intelligence
JCR agent: reconciliation logic, pattern detection.
Generate 30-50 simulated historical bid+reconciliation records for Archetype A (won, complete, with realistic variance patterns).
Intelligence agent: 3-5 grounded insights from historical data including capacity tension, margin trend, exclusions enforcement.
Dashboard UI: insights, margin heatmap by service line, capacity forecast chart.
End of day: dashboard showing real (simulated) intelligence; demoable end-to-end.
Day 6 — Follow-up + end-to-end polish
Follow-up agent: segment-aware scheduling logic, message drafting via Composition.
End-to-end test: full bid lifecycle for Archetype A (RFP → generation → send → follow-up → won → job complete → reconciled → intelligence update).
Run same flow for Archetype B (Dale’s data) to validate cross-vertical.
Polish UI flow for demo visibility of agent transitions.
End of day: full system running on 2 archetypes.
Day 7 — Demo + brief
Record demo video (7-8 min, see section 8.6).
Write brief (15-17 pages) per section 10 structure.
Polish architecture diagram.
Final QA: run demo flow 3x to ensure stability.
Send package to Tyler + Nitin.

10. Brief Structure
The 15-17 page brief that accompanies the demo. Sections, with what each carries.
10.1 Executive Summary (1 page)
The product, the moat, the path to revenue. Names ProService’s unique data position upfront. Lands the ‘not a GPT wrapper’ thesis.
10.2 The Concept (3-4 pages)
What the PoC does (matches the prompt literally — AI-powered bid generator).
Business model (subscription invoiced through PEO bill).
Operating model (CSM-led cross-sell into existing 3,000-employer base).
Pricing model (tiered, $99/$299/$499 per month + per-overage).
10.3 Customer Discovery (2 pages) — The Centerpiece
8-12 specialty contractors interviewed during the case window.
What the data showed: two SMB contractor segments with materially different bottlenecks.
Cavy at L&A Stucco as primary case study — with his direct quotes.
Implications: the prompt’s framing fits one segment cleanly; the other segment has a different, larger problem the same architecture solves.
This section is the version of you that does the discovery before the build.
10.4 Working Prototype (3-4 pages)
Architecture overview with diagram.
Walkthrough of the 8 agents — with the exclusions enforcement and capacity-awareness called out explicitly.
The 5 layers and what each delivers.
Stack and operational choices, including the explicit ‘no agent framework’ rationale.
10.5 Roadmap (2-3 pages)
Phase 1: Bid generation + exclusions enforcement (PoC, today).
Phase 2: Job-cost reconciliation (Q3, requires ProService payroll integration).
Phase 3: Capacity-aware pricing intelligence (Q4, requires schedule data layer).
Phase 4: Cross-vertical expansion (HVAC, marketing agencies, other PEO segments).
10.6 The AI Edge (2-3 pages)
Multi-agent architecture, not a GPT wrapper.
Tool-grounded numerics (Pricing agent, JCR agent).
Compounding context (every reconciled job makes the system smarter).
The ProService-unique moat (payroll integration enables job-cost reconciliation; no competitor without becoming a PEO can replicate this).
10.7 GTM Strategy (1-2 pages)
Launch into 5-10 Hawaii pilot clients via CSM warm intros.
Free during pilot phase for outcome capture and case study generation.
Conversion to paid at 60-day mark.
Expansion to AdvanStaff (Vegas) and Obsidian (Denver) once contextual layer proves generalizes.
10.8 Risks and Open Questions (1 page)
Data integration timing with payroll system.
Pilot client recruitment dependencies.
Pricing model unknowns.
What to validate before broader launch.

11. Risk Register
Risk 1: Cavy’s outcomes data doesn’t arrive in time
Likelihood: medium. Impact: medium.
Mitigation: Synthesize plausible outcomes consistent with Cavy’s self-reported 25-40% margin range and competitor list. Document the assumption in the brief’s Customer Discovery section. The demo still works because real corpus + plausible outcomes is dramatically more compelling than fully-synthetic.
Risk 2: Live demo unstable
Likelihood: medium. Impact: high.
Mitigation: Record demo end-to-end on day 6. Submit recorded version as primary deliverable. If invited to live-demo, run the same rehearsed flow. Have a reset-to-clean-state button.
Risk 3: Pricing agent produces unrealistic Hawaii numbers
Likelihood: medium. Impact: medium-high.
Mitigation: Validate simulated payroll dataset against BLS construction wage averages, DLIR prevailing wage, NCCI workers comp rates. If possible, have Dale Sandwith review the Archetype A pricing output before demo (30-min sanity check).
Risk 4: Composition agent voice mimicry is weak
Likelihood: low. Impact: medium.
Mitigation: Cavy’s voice is well-defined in the corpus (consistent formatting, predictable exclusions templates). Test by generating a quote against a known scope and comparing side-by-side with a real Cavy quote. Iterate prompt until indistinguishable on structure and tone.
Risk 5: Intelligence agent produces generic insights
Likelihood: medium. Impact: medium.
Mitigation: Hard-code n>=15 minimum sample size. Hand-curate 5 strong sample insights for Archetype A. Show one new insight generating live; pre-select 4 others to display from the warm dataset.
Risk 6: Exclusions verification feels like a gimmick
Likelihood: low. Impact: medium. New for v2.
Mitigation: Lead with a specific real exclusion Cavy uses (rough-grade-above-final-grade). Show the verification catching it. Tie it explicitly to scope creep cost. Customer discovery section already validates this as a real pain.
Risk 7: Scope creep on day 5+
Likelihood: high. Impact: high.
Mitigation: Day 5 end-of-day = feature freeze. Day 6 is integration only. Day 7 is polish + brief. Anything not building on day 5 is roadmap, not PoC.
Risk 8: Brief writing under-delivers
Likelihood: medium. Impact: high.
Mitigation: Write the brief skeleton today (day 0). Fill in as the build progresses. Customer Discovery section drafts after day 1. Day 7 morning is finalization, not from-scratch writing.

12. Stack & Operational Decisions
12.1 Models
Claude Sonnet 4 — Composition, Context, Intelligence, JCR synthesis. Strong generation + reasoning.
Claude Haiku 4.5 — Orchestrator routing, Intake extraction. Fast, cheap, structured tasks.
Embeddings: text-embedding-3-small (1536 dims, pgvector-friendly).
12.2 Backend
Python + FastAPI. Direct anthropic client. No LangChain, CrewAI, or LangGraph.
Postgres + pgvector for unified context store.
Background jobs: Celery + Redis for timer-based transitions and async batch.
S3 (or local equivalent) for raw documents.
12.3 Frontend
Streamlit for demo UI — fast to build, agent state visualization is straightforward.
Alternative deferred: Next.js if Streamlit polish becomes the bottleneck.
12.4 Why no agent framework
LangChain, CrewAI, LangGraph, AutoGen add abstraction overhead at this scope. 7 days, 8 agents, well-defined contracts — a clean Python orchestrator with direct API calls ships faster, debugs easier, and produces better demo output. The decision is defensible to Sam: ‘I evaluated the frameworks and decided the abstraction wasn’t earning its complexity for this scope.’
12.5 Repo structure
/proservice-bid-intelligence
  /agents
    orchestrator.py
    intake.py
    context.py
    pricing.py
    composition.py    # incl. verify_exclusions
    jcr.py            # NEW v2 (replaces win_loss.py)
    follow_up.py
    intelligence.py
  /tools
    pdf_extraction.py
    vector_search.py
    labor_cost_lookup.py
    capacity_lookup.py   # NEW v2
    exclusions_verify.py # NEW v2
    actual_hours_lookup.py # NEW v2 (JCR)
  /db
    schema.sql
    migrations/
    seed_data/
      cavy_quotes_anonymized/
      simulated_payroll_archetype_a.json
      schedule_allocations.json
      simulated_bid_history.json  # 30-50 reconciled bids
  /data
    /raw   # Cavy + others corpus
    /processed
  /api
    main.py
    routes/
  /ui
    streamlit_app.py
  /tests
    test_orchestrator.py
    test_pricing_calculations.py
    test_voice_extraction.py
    test_exclusions_verification.py  # NEW v2
    test_jcr_reconciliation.py       # NEW v2
  README.md
  pyproject.toml
12.6 Out of scope for the PoC
Production auth / multi-tenancy.
Real ProService payroll integration (simulated only).
Production deployment / scaling.
Full mobile UI.
Real outbound email/SMS sending.
Multi-language support.
Calendar integration.
E-signature / contract acceptance flow.
Real material cost API integrations (Pricing uses simulated lookups).
All of these are mentioned in the brief’s roadmap as Phase 2-4.
