# Demo Storyboard — 7.5-minute walkthrough

Maps spec §8.6 segments to specific CLI/UI clicks. The recording is the
primary deliverable per spec §11 Risk 2 (live demo unstable mitigation).

## Pre-demo setup (run once before recording)

```bash
# Clean state with all 3 archetypes
just reset
just ingest    # loads data/raw/ past quotes + sample inputs
just intelligence    # generates a few fresh insights to show

# (Optional) Switch to real tool-use Pricing for the strongest demo angle:
# set USE_TOOL_USE_PRICING=true in .env, then restart the API/UI
just api &
just ui
```

Open the Streamlit UI in the browser. Confirm sidebar shows three
companies (Honolulu Stucco, Vantage Millwork, Honolulu Brand Co.).

---

## Segment 1 — Contextual onboarding (90 s)

**Goal:** show the Context agent learning a contractor's voice, service
lines, and exclusions templates from past quotes.

**Click path:**
1. Select **Honolulu Stucco & Exteriors LLC** in the sidebar.
2. Click **Onboarding** in the View nav.
3. Point out: 8 past quotes ingested, 8 service lines extracted, the
   `tone` field, the boilerplate intro, the exclusions per service line.

**Talking point:** "This isn't a template — every line you see here was
extracted from Cavy's real corpus. Same architecture, but each company
gets a profile that matches its actual voice."

---

## Segment 2 — Bid generation (90 s)

**Goal:** show all 4 generation agents fire on a new scope, with
tool-grounded pricing.

**Click path:**
1. Click **Bid Generation**.
2. Fill the form:
   - Client name: `Esprit Heights Phase 2 — McKenzie GC`
   - Service line: `EIFS`
   - Scope: paste from `data/raw/sample_inputs/scope_email_esprit_heights.txt`
   - Segment: `repeat`
   - Start date: 4 weeks from today
   - Primary trade: `eifs`, hours: `312`
   - Helper hours: `80`
   - Material qty: `3200`
3. Click **Run all 4 generation agents**.
4. **Pause on the agent trail** in the status box (each agent firing).
5. **Pricing rationale appears.** Open **🔍 Numeric citation trail**.

**Talking point:** "Every number traces to a tool call. The Pricing
agent didn't generate $48,200 — it queried real loaded labor data and
multiplied. That's the difference between this and a GPT wrapper."

---

## Segment 3 — Exclusions enforcement (60 s)

**Goal:** the v2 sharpening moment from Cavy's discovery.

**Click path:**
1. Scroll to the generated bid draft.
2. If exclusions were verified present, point them out in the draft text.
3. To demo the catch case: regenerate with a small change so Composition
   misses an exclusion (or pre-seed a bid in EXCLUSIONS_REVIEW state).
4. Show the interactive form: each missing exclusion has **Add to quote** /
   **Skip** buttons.

**Talking point:** "Cavy's exclusions aren't boilerplate — they're
institutional memory. The rough-grade-above-final-grade exclusion exists
because of a real $22K scope-creep job. The agent enforces them."

---

## Segment 4 — Send + segment-aware follow-up (60 s)

**Goal:** show the Follow-up agent recognizing repeat-customer segment.

**Click path:**
1. Click **Send bid to client** on the generated bid.
2. State transitions: HUMAN_REVIEW → SENT.
3. Click **Follow-ups** in the nav.
4. Show the scheduled follow-up: **1 entry, +5 days, soft tone**.
5. Click **Draft message** — show the message in Cavy's voice.

**Talking point:** "Repeat customer gets a single 5-day soft touch.
Three-touch sequences damage relationships. This is what Cavy told us
in discovery — the agent encodes it."

---

## Segment 5 — Job-cost reconciliation (90 s)

**Goal:** show the moat — quoted vs actual via payroll.

**Click path:**
1. Click **Job-Cost Reconciliation**.
2. Top metrics: reconciled jobs, avg delivered margin, avg labor variance.
3. **Hover the histogram** — show distribution of delivered margins.
4. **Variance by service line** table — point out EIFS variance is +12-18%.
5. Pick a specific reconciled bid; click into it from Active Bids.

**Talking point:** "We didn't quote 33.5% — Cavy quoted 35.7%. The system
sees the gap because ProService runs payroll. No other tool can do this
without becoming a PEO. Every reconciled job updates the margin profile
that feeds the next bid."

---

## Segment 6 — Intelligence dashboard (90 s)

**Goal:** show the synthesis that's impossible without all the prior
layers.

**Click path:**
1. Click **Intelligence Dashboard**.
2. Show the three insight categories:
   - **Capacity:** "Hold firm on Esprit Heights — schedule is 82% full"
   - **Margin:** "EIFS delivered margin trending down 6pp"
   - **Exclusions:** "2 of 8 stucco-conventional quotes missing rough-grade"
3. **Capacity forecast chart** — point out the hold-firm threshold line.

**Talking point:** "This is what 'compounding context' looks like. The
Intelligence agent reads every other agent's output. The capacity insight
combines forward schedule, open quotes, and historical pricing
discipline. The margin insight ties JCR variance to Pricing formula
recalibration."

---

## Segment 7 — Architecture (60 s)

**Goal:** explicit "not a GPT wrapper" frame.

**Click path:**
1. Click **Agent Architecture**.
2. Walk down the 8-agent table.
3. Read the three bullets at the bottom.

**Talking point:** "Eight specialized agents. Tool-grounded numerics on
Pricing and JCR. Closed-loop intelligence that compounds with every job.
This is the architecture. Phase 1 ships the bid generator. Phase 2 turns
on JCR. Phase 3 turns on capacity-aware pricing. Each phase enables the
next."

---

## Total runtime: ~7.5 minutes

## Recording tips

- Run `just reset` immediately before recording to ensure clean state.
- Keep an unused browser tab open to `http://localhost:8000/docs` in case
  someone asks about the API.
- The Streamlit `st.rerun()` calls in action buttons will refresh the
  page — give them a beat before talking.
- Have `data/raw/sample_inputs/scope_email_esprit_heights.txt` open in a
  text editor so you can copy-paste cleanly.
- If exclusions verification doesn't catch anything on your first run,
  the seeded service_line standard_exclusions list is the source of
  truth — the generated draft has to literally miss them. Tweaking the
  Composition prompt or rerunning usually surfaces the catch case.
