-- 008_agent_tables.sql
--
-- Agent layer (companion to 007_context_chunks). Six tables, one per
-- non-Context agent in Brief's architecture:
--
--   Intake          → intake_documents
--   Offer           → offer_recommendations
--   Composition     → composition_drafts
--   Win/Loss        → winloss_signals
--   Follow-up       → followup_schedules
--   Intelligence    → intelligence_findings
--
-- All tenant-scoped (shop_id NOT NULL) with RLS via current_shop_id().
-- The agents share Context (007) for voice/scope/pricing retrieval —
-- these tables only persist agent-specific outputs.
--
-- Design principle: agents produce structured outputs, app code
-- executes deterministic logic on top. No table here stores an
-- LLM-generated number that wasn't routed through a deterministic
-- post-process. Free-text rationale + citations are fine; raw numeric
-- assertions are not.

-- ───────────────────────────────────────────────────────────────────
-- Intake agent — document classification + structured extraction.
-- One row per ingested document (PDF, pasted text, voice transcript,
-- email body). The same physical document may produce N intake rows
-- over time as we re-process with newer classifiers.
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intake_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  quote_id        uuid REFERENCES quotes(id) ON DELETE SET NULL,

  -- Where the text came from. Determines downstream UX (a voice
  -- transcript routes differently than an uploaded PDF).
  source_kind     text NOT NULL CHECK (source_kind IN (
    'pdf_upload','pasted_text','voice_transcript','email_body','manual_entry'
  )),
  source_filename text,
  raw_text        text NOT NULL,

  -- Classification axis. Taxonomy is explicit per the design
  -- conversation; routing keys on this value.
  classification  text NOT NULL CHECK (classification IN (
    'itemized_project_quote',      -- Cavy-style: line items, qty/unit/price
    'templated_partnership_pitch', -- Hardie-style: rebates, transition plan
    'narrative_consulting_proposal', -- Paras-style: phases, deliverables
    'inbound_rfi',                 -- uOttawa-style: buyer asking us to respond
    'change_request',              -- mid-job scope change
    'unknown'
  )),
  classification_confidence numeric(4,3) NOT NULL DEFAULT 0 CHECK (classification_confidence BETWEEN 0 AND 1),

  -- Structured extract per classification. Schema lives in
  -- lib/intake-agent.ts; the column is jsonb so we can evolve without
  -- migrations. Examples:
  --   itemized: { line_items: [...], scope_summary, flags }
  --   partnership: { needs: [...], solutions: [...], rebate_terms, term_months }
  --   consulting: { phases: [...], deliverables: [...], no_pricing: true }
  --   rfi: { requirements: [...], questions: [...], deadline, submission_format }
  extracted       jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Operator override. When auto-route confidence < 0.9 the UI prompts
  -- the operator to confirm; their choice is recorded here.
  operator_classification text,
  operator_confirmed_at   timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS intake_documents_shop_recency_idx
  ON intake_documents (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS intake_documents_quote_idx
  ON intake_documents (quote_id) WHERE quote_id IS NOT NULL;

ALTER TABLE intake_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY intake_documents_tenant_all ON intake_documents
  FOR ALL USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id());

-- ───────────────────────────────────────────────────────────────────
-- Offer agent — price recommendations with citation trail.
-- Produces a recommended price range (low/center/high), a structured
-- breakdown (labor / materials / overhead / margin), and a list of
-- citations: which company-profile chunks + which past quotes drove
-- each number. No raw LLM-asserted numerics; everything traces back.
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offer_recommendations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  quote_id        uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,

  -- The structured lookup spec the LLM produced (labor_lookups,
  -- material_lookups, win_rate_lookups, rationale_template). Saved
  -- for audit + reproducibility — if the operator asks "why did Brief
  -- recommend this?", we render this back to them.
  lookup_spec     jsonb NOT NULL,

  -- The deterministic computation result that the app code produced
  -- from the lookup spec. Includes labor_total, material_total,
  -- overhead, margin_low/center/high, capacity_signal.
  computed        jsonb NOT NULL,

  -- Final rendered rationale (template + numbers filled in).
  rationale_text  text NOT NULL,

  -- Citations: array of { source, ref, contribution } so the UI can
  -- show "this $4,200 labor figure came from quote Q-2026-0142 and
  -- voice_sample voice/stucco_labor_hourly".
  citations       jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Three-point range. The operator picks one or overrides.
  recommended_low     numeric(12,2) NOT NULL,
  recommended_center  numeric(12,2) NOT NULL,
  recommended_high    numeric(12,2) NOT NULL,
  confidence          numeric(4,3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offer_recommendations_quote_idx
  ON offer_recommendations (quote_id, created_at DESC);

ALTER TABLE offer_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY offer_recommendations_tenant_all ON offer_recommendations
  FOR ALL USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id());

-- ───────────────────────────────────────────────────────────────────
-- Composition agent — voice-matched drafts of bid prose.
-- One row per draft revision. Pulls from Context (voice) + the quote
-- structure + Offer's rationale. Output is the actual prose the
-- operator sends; revision history is searchable.
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS composition_drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  quote_id        uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,

  kind            text NOT NULL CHECK (kind IN (
    'cover_note','scope_narrative','exclusions','terms','closing','full_proposal'
  )),
  revision        integer NOT NULL DEFAULT 1,

  draft_text      text NOT NULL,
  prompt_context  jsonb NOT NULL DEFAULT '{}'::jsonb,

  used_at         timestamptz,  -- set when operator actually sent this draft
  created_at      timestamptz NOT NULL DEFAULT now(),

  UNIQUE (quote_id, kind, revision)
);

CREATE INDEX IF NOT EXISTS composition_drafts_quote_idx
  ON composition_drafts (quote_id, kind, revision DESC);

ALTER TABLE composition_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY composition_drafts_tenant_all ON composition_drafts
  FOR ALL USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id());

-- ───────────────────────────────────────────────────────────────────
-- Win/Loss agent — captures outcomes + infers contributing factors.
-- Fires async after a quote moves to WON/LOST/WITHDRAWN. The
-- inference (factors) is the LLM's read of why; the app feeds these
-- back into Context as new chunks once n≥3 for a given factor pattern.
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS winloss_signals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  quote_id        uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE UNIQUE,

  outcome         text NOT NULL CHECK (outcome IN ('won','lost','withdrawn','no_decision')),
  captured_reason text,                    -- operator's free-text "why"
  inferred_factors jsonb NOT NULL DEFAULT '[]'::jsonb,
                                           -- [{ factor, weight, evidence }]

  -- Snapshot of quote at decision time for retrospective comparison.
  snapshot        jsonb NOT NULL DEFAULT '{}'::jsonb,

  ready_for_intelligence boolean NOT NULL DEFAULT false,
                                           -- flipped true when n≥ thresholds met

  captured_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS winloss_signals_shop_outcome_idx
  ON winloss_signals (shop_id, outcome, captured_at DESC);

ALTER TABLE winloss_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY winloss_signals_tenant_all ON winloss_signals
  FOR ALL USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id());

-- ───────────────────────────────────────────────────────────────────
-- Follow-up agent — schedules + drafts post-bid touches.
-- Reads from quotes.sent_at + historical winning cadence to pick
-- the right day; uses Composition to draft the actual message.
-- Operator approves before send (configurable later to auto-send).
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS followup_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  quote_id        uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,

  kind            text NOT NULL CHECK (kind IN (
    'initial_check_in','gentle_nudge','last_call','postmortem'
  )),

  scheduled_for   timestamptz NOT NULL,
  draft_text      text,
  draft_revision  integer NOT NULL DEFAULT 1,

  status          text NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled','approved','sent','cancelled','superseded'
  )),
  approved_at     timestamptz,
  sent_at         timestamptz,
  cancelled_reason text,

  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS followup_schedules_due_idx
  ON followup_schedules (shop_id, scheduled_for) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS followup_schedules_quote_idx
  ON followup_schedules (quote_id, scheduled_for);

ALTER TABLE followup_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY followup_schedules_tenant_all ON followup_schedules
  FOR ALL USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id());

-- ───────────────────────────────────────────────────────────────────
-- Intelligence agent — published business-owner-level findings.
-- Four finding types per the design:
--   capacity_pricing     — utilization vs open quotes
--   winrate_by_size      — deal-size cohort vs hit rate
--   margin_trend         — delivered margin drift by service line
--   exclusions_drift     — exclusion-omission patterns
--
-- Contract: a finding includes the supporting bid IDs, the n it's
-- based on, and a projected dollar impact when computable. Findings
-- below sample-size thresholds (n<15 for win/loss, n<8 for service
-- lines) are not published.
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence_findings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,

  finding_type    text NOT NULL CHECK (finding_type IN (
    'capacity_pricing','winrate_by_size','margin_trend','exclusions_drift'
  )),

  -- One-sentence operator-facing headline. Punchy, specific, money-anchored.
  headline        text NOT NULL,
  -- Multi-paragraph body with the supporting analysis.
  body            text NOT NULL,

  -- Supporting evidence.
  supporting_quote_ids  uuid[] NOT NULL DEFAULT '{}',
  supporting_job_ids    uuid[] NOT NULL DEFAULT '{}',
  sample_size           integer NOT NULL,
  projected_impact_usd  numeric(12,2),  -- nullable when not computable

  -- Lifecycle.
  generated_at    timestamptz NOT NULL DEFAULT now(),
  surfaced_at     timestamptz,           -- shown in the UI
  dismissed_at    timestamptz,           -- operator dismissed
  acted_on_at     timestamptz,           -- operator pressed the recommended-action button
  expires_at      timestamptz            -- some findings (e.g. capacity) go stale
);

CREATE INDEX IF NOT EXISTS intelligence_findings_shop_recency_idx
  ON intelligence_findings (shop_id, generated_at DESC)
  WHERE dismissed_at IS NULL;

ALTER TABLE intelligence_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY intelligence_findings_tenant_all ON intelligence_findings
  FOR ALL USING (shop_id = current_shop_id()) WITH CHECK (shop_id = current_shop_id());
