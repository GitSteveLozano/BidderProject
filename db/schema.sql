-- ProService Bid Intelligence — shared context store
-- Schema per spec v2.0 §4 (15 tables). Postgres 15+ with pgvector.
-- Run: psql "$DATABASE_URL" -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ────────────────────────────────────────────────────────────────
-- 4.1 companies
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    proservice_client_id  TEXT,
    name                  TEXT NOT NULL,
    dba                   TEXT,
    primary_trade         TEXT,
    secondary_trades      TEXT[],
    service_area          JSONB,
    size_band             TEXT,
    annual_revenue_band   TEXT,
    years_in_business     INTEGER,
    vertical_template     TEXT,
    segment               TEXT CHECK (segment IN ('repeat_customer', 'cold_bidding', 'mixed')),
    onboarded_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────────
-- 4.2 voice_patterns
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS voice_patterns (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id               UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    tone                     TEXT,
    avg_sentence_length      INTEGER,
    preferred_terms          JSONB,
    avoided_terms            TEXT[],
    boilerplate_intro        TEXT,
    boilerplate_scope_intro  TEXT,
    boilerplate_terms        TEXT,
    boilerplate_warranty     TEXT,
    boilerplate_closing      TEXT,
    formatting               JSONB,
    voice_embedding          vector(1536),
    source_document_ids      UUID[],
    last_extracted_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (company_id)
);

-- ────────────────────────────────────────────────────────────────
-- 4.3 service_lines (NEW v2 — promoted from scope_patterns)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS service_lines (
    id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id                UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    line_name                 TEXT NOT NULL,
    typical_scope_text        TEXT,
    standard_exclusions       TEXT[],
    pricing_unit              TEXT CHECK (pricing_unit IN ('lump_sum', 'per_sqft', 'per_lf', 'hourly')),
    pricing_range_residential JSONB,
    pricing_range_commercial  JSONB,
    typical_margin_pct        DECIMAL(5,2),
    manufacturers_referenced  TEXT[],
    last_extracted_at         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (company_id, line_name)
);

-- ────────────────────────────────────────────────────────────────
-- 4.4 pricing_logic
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_logic (
    id                           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id                   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    default_labor_markup_pct     DECIMAL(5,2),
    default_material_markup_pct  DECIMAL(5,2),
    overhead_pct                 DECIMAL(5,2),
    target_margin_pct            DECIMAL(5,2),
    margin_range_low_pct         DECIMAL(5,2),
    margin_range_high_pct        DECIMAL(5,2),
    capacity_discount_behavior   TEXT CHECK (capacity_discount_behavior IN ('flex_by_schedule', 'fixed')),
    minimum_bid_threshold        DECIMAL(12,2),
    payment_terms_default        TEXT,
    deposit_pct                  DECIMAL(5,2),
    pricing_by_service_line      JSONB,
    last_recomputed_at           TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (company_id)
);

-- ────────────────────────────────────────────────────────────────
-- 4.5 scope_patterns
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scope_patterns (
    id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id            UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    typical_inclusions    TEXT[],
    typical_assumptions   TEXT[],
    addenda_patterns      TEXT[],
    upgrade_patterns      TEXT[],
    last_extracted_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (company_id)
);

-- ────────────────────────────────────────────────────────────────
-- 4.6 bids
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bids (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id               UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    source_input_doc_id      UUID,
    state                    TEXT NOT NULL DEFAULT 'RFP_RECEIVED',
    service_line             TEXT,
    job_type                 TEXT,
    client_name              TEXT,
    client_segment           TEXT CHECK (client_segment IN ('repeat', 'new', 'cold_lead')),
    job_address              JSONB,
    scope_summary            TEXT,
    estimated_value          DECIMAL(12,2),
    estimated_labor_hours    INTEGER,
    estimated_start_date     DATE,
    estimated_duration_days  INTEGER,
    bid_deadline             TIMESTAMPTZ,
    draft_document_id        UUID,
    sent_document_id         UUID,
    pricing_breakdown        JSONB,
    exclusions_applied       TEXT[],
    exclusions_missing       TEXT[],
    capacity_at_quote        DECIMAL(5,2),
    created_at               TIMESTAMPTZ DEFAULT NOW(),
    draft_generated_at       TIMESTAMPTZ,
    sent_at                  TIMESTAMPTZ,
    outcome_captured_at      TIMESTAMPTZ,
    outcome                  TEXT,
    outcome_reason           TEXT,
    outcome_competitor       TEXT,
    outcome_winning_bid      DECIMAL(12,2),
    actual_labor_hours       INTEGER,
    actual_cost_total        DECIMAL(12,2),
    delivered_margin_pct     DECIMAL(5,2)
);

CREATE INDEX IF NOT EXISTS idx_bids_company_state ON bids (company_id, state);
CREATE INDEX IF NOT EXISTS idx_bids_service_line ON bids (company_id, service_line);
CREATE INDEX IF NOT EXISTS idx_bids_estimated_start ON bids (estimated_start_date);

-- ────────────────────────────────────────────────────────────────
-- 4.7 bid_state_history
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bid_state_history (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_id          UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
    from_state      TEXT,
    to_state        TEXT NOT NULL,
    triggered_by    TEXT,
    agent_call_id   UUID,
    notes           TEXT,
    occurred_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bid_state_history_bid ON bid_state_history (bid_id, occurred_at);

-- ────────────────────────────────────────────────────────────────
-- 4.8 follow_ups
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS follow_ups (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_id              UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
    sequence_number     INTEGER NOT NULL,
    scheduled_for       TIMESTAMPTZ NOT NULL,
    state               TEXT NOT NULL DEFAULT 'SCHEDULED',
    channel             TEXT,
    draft_message       TEXT,
    sent_at             TIMESTAMPTZ,
    response_received   BOOLEAN DEFAULT FALSE,
    response_summary    TEXT
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_due ON follow_ups (state, scheduled_for);

-- ────────────────────────────────────────────────────────────────
-- 4.9 documents
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id         UUID REFERENCES companies(id) ON DELETE CASCADE,
    type               TEXT NOT NULL,
    filename           TEXT,
    s3_key             TEXT,
    raw_text           TEXT,
    structured_data    JSONB,
    embedding          vector(1536),
    uploaded_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_company_type ON documents (company_id, type);
-- HNSW index for fast vector search (created after seed for better build perf in real deploys)
-- CREATE INDEX IF NOT EXISTS idx_documents_embedding ON documents USING hnsw (embedding vector_cosine_ops);

-- ────────────────────────────────────────────────────────────────
-- 4.10 employees (simulated payroll layer)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employees (
    id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id               UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name                     TEXT NOT NULL,
    trade_classification     TEXT NOT NULL,
    ncci_class_code          TEXT,
    base_hourly_rate         DECIMAL(8,2),
    ot_multiplier            DECIMAL(4,2) DEFAULT 1.5,
    apprentice_level         TEXT,
    is_prevailing_wage_only  BOOLEAN DEFAULT FALSE,
    status                   TEXT DEFAULT 'active',
    hire_date                DATE
);

CREATE INDEX IF NOT EXISTS idx_employees_trade ON employees (company_id, trade_classification);

-- ────────────────────────────────────────────────────────────────
-- 4.11 burden_components (simulated)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS burden_components (
    id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id                UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    effective_date             DATE NOT NULL,
    fica_pct                   DECIMAL(5,4),
    futa_pct                   DECIMAL(5,4),
    suta_pct                   DECIMAL(5,4),
    workers_comp_rate_per_100  DECIMAL(6,3),
    experience_mod_factor      DECIMAL(4,3) DEFAULT 1.0,
    phca_health_monthly        DECIMAL(8,2),
    tdi_employer_weekly        DECIMAL(8,2),
    retirement_match_pct       DECIMAL(5,4),
    pto_accrual_hours_yr       INTEGER,
    training_annual            DECIMAL(8,2),
    other_benefits_monthly     DECIMAL(8,2),
    total_burden_pct           DECIMAL(5,4),
    loaded_hourly_rate         DECIMAL(8,2)
);

CREATE INDEX IF NOT EXISTS idx_burden_employee ON burden_components (employee_id, effective_date);

-- ────────────────────────────────────────────────────────────────
-- 4.12 schedule_allocations (NEW v2)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedule_allocations (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    employee_id        UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    bid_id             UUID REFERENCES bids(id) ON DELETE SET NULL,
    company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    week_start_date    DATE NOT NULL,
    allocated_hours    INTEGER NOT NULL,
    trade_role         TEXT,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_week ON schedule_allocations (company_id, week_start_date);

-- ────────────────────────────────────────────────────────────────
-- 4.13 prevailing_wages (Hawaii)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prevailing_wages (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    trade           TEXT NOT NULL,
    county          TEXT NOT NULL,
    basic_hourly    DECIMAL(8,2),
    fringe_hourly   DECIMAL(8,2),
    total_hourly    DECIMAL(8,2),
    effective_date  DATE,
    bulletin_number TEXT
);

CREATE INDEX IF NOT EXISTS idx_prevailing_trade_county ON prevailing_wages (trade, county, effective_date);

-- ────────────────────────────────────────────────────────────────
-- 4.14 job_cost_reconciliation (NEW v2)
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_cost_reconciliation (
    id                         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_id                     UUID NOT NULL UNIQUE REFERENCES bids(id) ON DELETE CASCADE,
    company_id                 UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    quoted_price               DECIMAL(12,2),
    quoted_labor_hours         INTEGER,
    quoted_labor_cost          DECIMAL(12,2),
    quoted_material_cost       DECIMAL(12,2),
    quoted_margin_pct          DECIMAL(5,2),
    actual_labor_hours         INTEGER,
    actual_labor_cost          DECIMAL(12,2),
    actual_material_cost       DECIMAL(12,2),
    actual_other_costs         DECIMAL(12,2),
    delivered_margin_pct       DECIMAL(5,2),
    variance_labor_hours_pct   DECIMAL(6,2),
    variance_total_cost_pct    DECIMAL(6,2),
    notes                      TEXT,
    reconciled_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jcr_company ON job_cost_reconciliation (company_id, reconciled_at);

-- ────────────────────────────────────────────────────────────────
-- 4.15 intelligence_insights
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS intelligence_insights (
    id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id         UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    generated_at       TIMESTAMPTZ DEFAULT NOW(),
    category           TEXT CHECK (category IN ('pricing', 'capacity', 'margin', 'competitor', 'follow_up', 'exclusions')),
    severity           TEXT CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
    headline           TEXT NOT NULL,
    finding            TEXT,
    recommendation     TEXT,
    projected_impact   TEXT,
    supporting_bids    UUID[],
    status             TEXT DEFAULT 'open'
);

CREATE INDEX IF NOT EXISTS idx_insights_company_status ON intelligence_insights (company_id, status, generated_at DESC);

-- ────────────────────────────────────────────────────────────────
-- Updated-at trigger (applies to companies)
-- ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS companies_updated_at ON companies;
CREATE TRIGGER companies_updated_at
    BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ────────────────────────────────────────────────────────────────
-- audit_log (migration 0002) — append-only mutation history
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    occurred_at     TIMESTAMPTZ DEFAULT NOW(),
    entity_type     TEXT NOT NULL,
    entity_id       UUID,
    company_id      UUID,
    action          TEXT NOT NULL,
    actor           TEXT,
    request_id      TEXT,
    agent_call_id   UUID,
    diff            JSONB,
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity
    ON audit_log (entity_type, entity_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_company
    ON audit_log (company_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_request
    ON audit_log (request_id) WHERE request_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────────
-- margin_snapshot_quarterly (migration 0003) — fast heatmap source
-- ────────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS margin_snapshot_quarterly AS
SELECT
    j.company_id,
    b.service_line,
    date_trunc('quarter', j.reconciled_at)::date AS quarter,
    AVG(j.delivered_margin_pct)::numeric(6,2) AS avg_margin_pct,
    AVG(j.variance_labor_hours_pct)::numeric(6,2) AS avg_labor_var_pct,
    AVG(j.variance_total_cost_pct)::numeric(6,2) AS avg_cost_var_pct,
    SUM(b.estimated_value)::numeric(14,2) AS total_revenue,
    COUNT(*) AS n_jobs,
    NOW() AS refreshed_at
FROM job_cost_reconciliation j
JOIN bids b ON b.id = j.bid_id
GROUP BY j.company_id, b.service_line, date_trunc('quarter', j.reconciled_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_margin_snapshot_pk
    ON margin_snapshot_quarterly (company_id, service_line, quarter);
CREATE INDEX IF NOT EXISTS idx_margin_snapshot_company
    ON margin_snapshot_quarterly (company_id, quarter);
