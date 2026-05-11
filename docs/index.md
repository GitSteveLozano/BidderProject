---
title: ProService Bid Intelligence
---

# ProService Bid Intelligence

> Multi-agent AI platform that helps SMB specialty contractors operate
> more effectively across the full bid lifecycle — from RFP/scope intake
> through job-cost reconciliation.

> 9 specialized agents · tool-grounded numerics · payroll-integrated · 206 unit tests

---

## 🚀 Try the interactive demo

This page is the project's static landing. The actual click-around demo
runs at one of three URLs depending on how it's deployed:

| Path | Cost | Time to live demo | Best for |
| --- | --- | --- | --- |
| **🟢 Cloudflare Pages SPA** *(in development — see `/web/`)* | $0 | already auto-deploys on push | Customer-facing product |
| **🟡 Streamlit Cloud + Supabase** *(see [15-min quickstart]({{ "/deployment/streamlit-cloud-quickstart.html" | relative_url }}))* | $0 | ~15 min one-time setup | Internal demos, fastest path |
| **🔵 Local `docker compose up`** *(see [README](https://github.com/GitSteveLozano/BidderProject))* | $0 | ~5 min | Development, full stack with API + Celery + Postgres |

The Cloudflare SPA is the long-term product surface. The Streamlit
deployment is the fastest path to a clickable URL right now; the local
docker stack runs the canonical Python FastAPI backend.

---

## What this is

Eight specialized agents (Orchestrator, Intake, Context, Pricing,
Composition, Job-Cost Reconciliation, Follow-up, Intelligence) plus a
9th loss-postmortem extension agent coordinate over a shared
Postgres + pgvector context store. The Pricing and JCR agents are
tool-grounded — they query real loaded labor data rather than
generating numbers. The Composition agent verifies standard exclusions
before marking a draft ready. The Intelligence agent runs async over
aggregated state to surface capacity-aware insights.

---

## The pages

- **[Brief]({{ "/brief.html" | relative_url }})** — the 15-page case-exercise deliverable
- **[Architecture spec v2.0]({{ "/architecture_spec_v2.html" | relative_url }})** — full specification
- **[Codebase tour]({{ "/ARCHITECTURE.html" | relative_url }})** — where each spec section is implemented
- **[Demo storyboard]({{ "/demo_storyboard.html" | relative_url }})** — 7.5-minute walkthrough
- **[Agents]({{ "/pages/agents.html" | relative_url }})** — the 8 agents in detail
- **[Architecture diagram]({{ "/pages/architecture.html" | relative_url }})** — visual overview
- **[Sample output]({{ "/pages/sample_output.html" | relative_url }})** — what a generated bid looks like

PDF copies (built from the markdown sources by `scripts/build_brief.py`):

- [ProService-Bid-Intelligence-Brief.pdf]({{ "/dist/ProService-Bid-Intelligence-Brief.pdf" | relative_url }})
- [ProService-Bid-Intelligence-Architecture-v2.pdf]({{ "/dist/ProService-Bid-Intelligence-Architecture-v2.pdf" | relative_url }})
- [ProService-Demo-Storyboard.pdf]({{ "/dist/ProService-Demo-Storyboard.pdf" | relative_url }})

---

## The five layers

1. **Contextual Onboarding** — ingest past quotes; learn voice, service
   lines, exclusions templates, pricing patterns.
2. **Bid Generation** — drawings + scope email → polished bid in
   company voice with exclusions enforced and pricing tool-grounded.
3. **Follow-up Automation** — segment-aware cadence (single soft 5-day
   touch for repeat customers; 3-touch for cold leads).
4. **Job-Cost Reconciliation** — quoted price vs. actual delivered cost
   via ProService payroll. Closes the loop.
5. **Capacity-Aware Operating Intelligence** — cross-cutting analytics
   over forward schedule + delivered-margin trends + win/loss patterns.

---

## Why this is not a GPT wrapper

- **Specialization.** Each agent uses the model best suited to its
  task. Orchestrator + Intake on Haiku; synthesis on Sonnet.
- **Tool-grounded numerics.** The Pricing agent NEVER generates labor
  cost from text — it calls `get_loaded_labor_cost(trade, hours)` which
  returns real loaded-labor data. Same for capacity and JCR.
- **Closed-loop intelligence.** Every reconciled job updates the
  service-line margin profile that feeds the next bid's Pricing agent.
  This compounds with every job. No competitor without payroll
  integration (i.e., without being a PEO) can replicate it.

---

## The moat

ProService runs payroll for these companies. That gives the system
access to **fully-burdened labor cost per worker per trade** — NCCI
workers comp by class code, PHCA health, TDI, Hawaii prevailing wage.
ServiceTitan doesn't have this. Procore doesn't have this. ChatGPT
certainly doesn't.

Every reconciled job feeds the loop. After 50 reconciled jobs, the
system knows the contractor's real margin per service line better
than they do. After 200, it knows their labor productivity by trade.

---

## Run the demo

### Free interactive demo on Streamlit Cloud (~15 min one-time setup)

[Full guide]({{ "/deployment/streamlit-cloud.html" | relative_url }}) —
spin up a free Supabase Postgres + Streamlit Cloud deployment in about
15 minutes. The bootstrap shim (`streamlit_app.py` at the repo root)
auto-applies the schema and seeds all three archetypes on first load,
so the demo is clickable immediately.

Cost: $0. Anthropic API calls bill pay-as-you-go (~$0.10 per generated
bid; the **Estimate input cost** button on the Bid Generation page
shows the exact number before you click).

### Or run locally in 5 minutes:

```bash
git clone https://github.com/GitSteveLozano/BidderProject.git
cd BidderProject
cp .env.example .env       # add ANTHROPIC_API_KEY
docker compose up --build
docker compose exec api python -m db.seed_all
```

Then:

- UI:        <http://localhost:8501>
- API docs:  <http://localhost:8000/docs>

Walk through [the 7.5-minute storyboard]({{ "/demo_storyboard.html" | relative_url }})
to hit every demo segment in order.

For headless verification, the CLI runs an end-to-end demo flow
without the UI:

```bash
python cli.py demo
```

---

## Tech

| Surface             | Stack                                          |
| ------------------- | ---------------------------------------------- |
| Models              | Claude Opus 4.7 / Sonnet 4.6 / Haiku 4.5       |
| Embeddings          | `text-embedding-3-small` (1536-dim, pgvector)  |
| Backend             | Python 3.11 · FastAPI · `anthropic` SDK direct |
| Data                | Postgres 16 + pgvector                         |
| Async               | Celery + Redis (follow-up timers, nightly JCR) |
| UI                  | Streamlit                                      |
| Tests               | pytest · 154 unit + 17 Postgres integration    |

Per spec §12.4: no agent framework. Direct SDK. *"I evaluated
LangChain, CrewAI, and LangGraph; the abstraction wasn't earning
its complexity for this scope."*

---

## Repository

Source code: <https://github.com/GitSteveLozano/BidderProject>

This Pages site auto-publishes from the `docs/` folder on every push
to the active development branch via `.github/workflows/pages.yml`.
