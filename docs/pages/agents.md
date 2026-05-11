---
title: The 8 Agents
---

# The 8 Agents

Spec §5. Each agent owns one narrow concern; the orchestrator coordinates.

| Agent           | Responsibility                                                       | Model              |
| --------------- | -------------------------------------------------------------------- | ------------------ |
| Orchestrator    | Routes workflows, manages bid state, merges outputs                  | `claude-haiku-4-5` |
| Intake          | Parses RFPs, drawings, scope emails, change requests, past quotes    | `claude-haiku-4-5` |
| Context         | Owns the company profile: voice, service lines, pricing logic        | `claude-sonnet-4-6` |
| **Pricing**     | Calibrated pricing via real loaded-labor tool calls + capacity-aware | `claude-sonnet-4-6` + tools |
| **Composition** | Bid generation in voice; **verifies standard exclusions present**    | `claude-sonnet-4-6` |
| **JCR**         | Closes the loop quoted→actual via payroll; pattern detection         | `claude-sonnet-4-6` + tools |
| Follow-up       | Post-send lifecycle, **segment-aware cadence**                       | `claude-sonnet-4-6` |
| Intelligence    | Cross-cutting synthesis, capacity-aware insights (async, batch)      | `claude-sonnet-4-6` |

The bold items are the v2 sharpening points from customer discovery:

- **Exclusions enforcement is first-class.** Composition checks every
  draft against the company's standard exclusions for the service line
  before transitioning to DRAFT_GENERATED. If anything is missing, the
  state machine routes to EXCLUSIONS_REVIEW. This is straight from
  Cavy's pain — a missing exclusion costs real money in scope creep.
- **Capacity-awareness in Pricing.** The Pricing agent calls
  `get_capacity_utilization()` for the bid's estimated start window
  and produces a `capacity_modifier` — hold firm when full, consider
  discount when light. Encodes Cavy's actual behavior.
- **Segment-aware follow-up.** Repeat-customer contractors get a single
  soft 5-day touch (per Cavy). Cold-bidders get the full 3-touch
  48hr/5d/10d sequence.

---

## Hallucination-resistance guarantee (spec §1.5)

The Pricing agent's behavior contract:

> **NEVER generates labor or material cost numbers directly. Every
> numeric value traces to a tool call.**

In the code: `agents/pricing.py::compute_pricing` is deterministic
Python math over the outputs of `get_loaded_labor_cost`,
`lookup_material_cost`, `get_pricing_logic`, and
`get_capacity_utilization`. Only the narrative rationale is LLM-
generated, and the LLM is explicitly forbidden in its system prompt
from changing numbers.

Same pattern in JCR: math is deterministic; narrative is LLM.

The Pricing variant in `agents/pricing_tool_use.py` uses real
Anthropic tool-use (`tools=[...]` in `messages.create`) so Claude
itself decides which tool to call. The demo can switch between the
two via the `USE_TOOL_USE_PRICING` feature flag.

---

## Tools (`/tools` folder)

Each tool function is a small Python function called by the agent. The
moat — tool-grounded numerics — lives here.

| Tool                          | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `get_loaded_labor_cost`       | Returns burdened cost per trade per hour             |
| `get_capacity_utilization`    | Forward schedule utilization over a week window      |
| `lookup_material_cost`        | Per-unit material cost with waste factor             |
| `verify_exclusions`           | Composition's required exclusion check               |
| `get_actual_labor_hours`      | Payroll integration (Phase 2)                        |
| `get_win_rate_at_price`       | Historical win rate in a price band                  |
| `get_optimal_cadence`         | Segment-aware follow-up cadence rules                |
| `extract_pdf_text`            | PDF → text for the Intake agent                      |
| `vector_search`               | pgvector similarity search over past documents       |

---

## State machine

19 states, fully observable. Every transition writes a row to
`bid_state_history` with `triggered_by` (auto / human / timer / seed)
and `notes`. The UI renders this as a timeline with per-trigger
emojis.

The terminal states are RECONCILED, LOST, WITHDRAWN, NO_DECISION.
Everything else can transition further.

```
RFP_RECEIVED → ASSESSING → DRAFT_GENERATED | EXCLUSIONS_REVIEW
              → HUMAN_REVIEW → SENT → WON | LOST | STALLED
              → JOB_IN_PROGRESS → JOB_COMPLETE → RECONCILED
```

Test coverage: `tests/test_state_machine.py` (14 tests) exercises
every transition + invalid ones.
