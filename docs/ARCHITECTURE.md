# Architecture

Quick map from the codebase to the spec. The canonical specification is
`architecture_spec_v2.md` — this document is a tour of where each spec
section is implemented.

## 8 Agents (spec §5 → `/agents`)

| Spec §  | Agent                          | File                      |
| ------- | ------------------------------ | ------------------------- |
| 5.1     | Orchestrator                   | `agents/orchestrator.py`  |
| 5.2     | Intake                         | `agents/intake.py`        |
| 5.3     | Context                        | `agents/context.py`       |
| 5.4     | Pricing                        | `agents/pricing.py`       |
| 5.5     | Composition (+ exclusions)     | `agents/composition.py`   |
| 5.6     | Job-Cost Reconciliation        | `agents/jcr.py`           |
| 5.7     | Follow-up (segment-aware)      | `agents/follow_up.py`     |
| 5.8     | Intelligence (meta, async)     | `agents/intelligence.py`  |

## Tools (spec §1.4 → `/tools`)

| Tool function                  | File                              |
| ------------------------------ | --------------------------------- |
| `extract_pdf_text`             | `tools/pdf_extraction.py`         |
| `vector_search`                | `tools/vector_search.py`          |
| `get_loaded_labor_cost`        | `tools/labor_cost_lookup.py`      |
| `get_capacity_utilization`     | `tools/capacity_lookup.py`        |
| `lookup_material_cost`         | `tools/material_cost_lookup.py`   |
| `verify_exclusions`            | `tools/exclusions_verify.py`      |
| `get_actual_labor_hours`       | `tools/actual_hours_lookup.py`    |
| `get_optimal_cadence`          | `tools/cadence_lookup.py`         |
| `get_win_rate_at_price`        | `tools/win_rate_lookup.py`        |

## Database (spec §4 → `/db`)

15 tables in `db/schema.sql`. Seed script `db/seed.py` populates the
Cavy-derived "Honolulu Stucco & Exteriors" Archetype A profile with:

- 8 employees + burden components per §8.5
- 8 service lines with exclusions templates per §3.2 and §8.1
- 12 weeks of schedule_allocations matching the utilization curve in §8.5
- 40 historical bids with reconciliations across all service lines (EIFS
  deliberately runs +12-18% over so the Intelligence agent has a pattern)
- 5 starter `intelligence_insights` (capacity, margin, exclusions, etc.)

## State machine (spec §6 → `core/states.py`)

Pure data + validation. Used by `agents/orchestrator.transition()`. All
transitions write `bid_state_history` rows. Test in
`tests/test_state_machine.py`.

## API (spec §12.5 → `/api`)

FastAPI app. Routes split by domain:

- `companies.py` — onboarding, profile, NL queries
- `documents.py` — upload + Intake invocation
- `bids.py` — full lifecycle (create → assess → send → outcome → reconcile)
- `intelligence.py` — insights, capacity forecast, margin-by-service-line

## UI (spec §8.6 → `/ui`)

Streamlit app. 7 demo segments mapped to the spec's demo flow timing.

## Model assignments (spec §12.1 — updated to current 4.x)

| Role                                      | Model              |
| ----------------------------------------- | ------------------ |
| Orchestrator routing, Intake extraction   | `claude-haiku-4-5` |
| Context, Composition, Pricing narrative, Follow-up, JCR, Intelligence | `claude-sonnet-4-6` |

Embeddings: `text-embedding-3-small` (1536-dim → pgvector).

## What is NOT a GPT wrapper (spec §1.5)

1. **Tool-grounded numerics** — Pricing and JCR never generate numbers.
   `agents/pricing.py::compute_pricing` is deterministic math over tool
   outputs; only the narrative rationale is LLM-generated and the LLM is
   explicitly forbidden from changing numbers.
2. **Specialization** — Intake/Orchestrator on Haiku; synthesis on Sonnet.
3. **Closed loop** — `agents/jcr.detect_patterns` updates
   `service_lines.typical_margin_pct` which feeds the next bid's Pricing
   agent. This is the moat. Compounds with every reconciled job.
