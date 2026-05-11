---
title: Architecture
---

# Architecture

## High-level diagram

```
                       ┌─────────────────────────────────────┐
                       │     INTELLIGENCE AGENT              │   (meta, async)
                       │     capacity-aware synthesis        │
                       └──────────────────┬──────────────────┘
                                          │ reads everything
                       ┌──────────────────▼──────────────────┐
                       │         ORCHESTRATOR                │
                       │     state machine + routing         │
                       └─┬─────┬─────┬─────┬─────┬─────┬─────┘
                         │     │     │     │     │     │
                       INTAKE CONTEXT PRICING COMP. JCR  F-UP
                         │     │     │     │     │     │
                         ▼     ▼     ▼     ▼     ▼     ▼
                       ┌────────────────────────────────────┐
                       │     SHARED CONTEXT STORE           │
                       │   Postgres + pgvector + S3         │
                       │   Companies · Bids · Outcomes      │
                       │   Voice · Pricing · Payroll(sim)   │
                       │   Service-lines · Schedule         │
                       └────────────────────────────────────┘

  Tool: Pricing agent calls get_loaded_labor_cost(trade, hours)
  Tool: Pricing agent calls get_capacity_utilization(window_weeks)
  Tool: Composition agent calls verify_exclusions(draft, service_line, company_id)
  Tool: Intake agent calls extract_pdf(document_id)
  Tool: JCR agent calls get_actual_labor_hours(bid_id) [via payroll integration]
```

## The five layers (spec §1.2)

| Layer | Name                                            | Owners                                       |
| ----- | ----------------------------------------------- | -------------------------------------------- |
| 1     | Contextual Onboarding                           | Intake + Context                             |
| 2     | Bid Generation                                  | Intake + Context + Pricing + Composition     |
| 3     | Follow-up Automation                            | Follow-up                                    |
| 4     | Job-Cost Reconciliation                         | JCR                                          |
| 5     | Capacity-Aware Operating Intelligence (meta)    | Intelligence (async over all of the above)   |

## Data schema (15 tables — spec §4)

| Table                     | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `companies`               | Multi-tenant root                                |
| `voice_patterns`          | Per-company voice + boilerplate                  |
| `service_lines`           | Each service line: scope template + exclusions   |
| `pricing_logic`           | Margin range, capacity behavior, deposit terms   |
| `scope_patterns`          | Cross-cutting scope content                      |
| `bids`                    | Lifecycle root                                   |
| `bid_state_history`       | Append-only state transitions                    |
| `follow_ups`              | Scheduled / sent follow-up touches               |
| `documents`               | Raw + structured + 1536-dim pgvector embeddings  |
| `employees`               | Payroll roster (per company)                     |
| `burden_components`       | FICA, FUTA, SUTA, workers comp, PHCA, TDI, etc.  |
| `schedule_allocations`    | Forward + completed allocations per week         |
| `prevailing_wages`        | Hawaii prevailing-wage reference                 |
| `job_cost_reconciliation` | Quoted vs actual after completion                |
| `intelligence_insights`   | Cross-cutting findings with severity + impact    |
| `audit_log`               | Append-only mutation history (migration 0002)    |

## Operational decisions (spec §12)

- **Models:** Haiku 4.5 for routing/extraction; Sonnet 4.6 for synthesis.
- **No agent framework:** direct `anthropic` SDK; FastAPI for the API
  layer; Streamlit for the demo UI. Per spec §12.4: *"I evaluated
  LangChain, CrewAI, and LangGraph; the abstraction wasn't earning its
  complexity for this scope."*
- **Async:** Celery + Redis. Four scheduled tasks: 5-min follow-up
  timer check, weekly Intelligence run, nightly JCR pattern detection,
  daily 14-day stalled-bid timer.
- **Prompt caching:** Composition splits system into a frozen
  SYSTEM_PROMPT + a per-company stable context block with
  `cache_control: {type: "ephemeral"}`. Every bid for the same company
  reuses the prefix.

## Test surface

- **Unit tests:** 154 passing, ~63% line + branch coverage. Stub at
  the SDK call site, so no API key needed.
- **Integration tests:** 17 marked `@pytest.mark.integration`, run
  in CI against a real pgvector service container. Exercises real
  schema, real seed scripts, real orchestrator end-to-end.
- **Cache-prefix regression:** SHA-256 hash of the cached prefix
  bytes; asserts two bids for the same company produce identical
  bytes (catches silent invalidators).
- **Behavior contract tests:** Pricing agent never asks the LLM to
  compute numbers; Composition prompt includes every standard
  exclusion verbatim; Intake schema rejects invalid service lines.
