-- Brief — initial schema (multi-tenant, RLS-enforced)
-- Replaces the legacy ProService Bid Intelligence schema entirely.
--
-- Apply order:
--   1. Run this file against a fresh Supabase project (or one where you've
--      manually dropped the legacy tables).
--   2. Run db/seed_brief.sql to populate one demo shop + clients + quotes.
--
-- Conventions:
--   - All ids are uuid via gen_random_uuid(). Supabase's pgcrypto is on by
--     default; we don't depend on uuid-ossp.
--   - Money is numeric(12,2). Render via the currency rule in
--     design/spec/README.md ("$1,234.56" or compact "$184k").
--   - Timestamps are timestamptz, default now().
--   - Tenant tables get a shop_id column and an RLS policy that scopes by
--     the authed user's memberships. cross-shop access is impossible at the
--     DB layer; the application layer never has to remember to filter.
--   - References to auth.users use Supabase's built-in auth schema. No FK
--     constraints across schemas (Supabase recommendation), but the column
--     type matches uuid.
--
-- Shapes mirror design/spec/data-shapes.md. Schema callouts there are
-- resolved here.

-- ───────────────────────────────────────────────────────────────────
-- Extensions
-- ───────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ───────────────────────────────────────────────────────────────────
-- shops — one row per onboarded contractor business
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE shops (
    id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity
    legal_name                  text NOT NULL,
    trade_name                  text,
    owner_name                  text NOT NULL,
    owner_email                 text NOT NULL,

    -- License (CSLB / DCCA / other state board)
    license_number              text,
    license_jurisdiction        text,           -- 'CA' | 'HI' | ...
    license_classification      text,           -- 'C-35', 'B-General', etc.
    license_expires_at          date,

    -- Pricing defaults (per design/agent-port-notes.md → Pricing math)
    default_markup_pct          numeric(5,2) DEFAULT 32.0,
    default_labor_rate          numeric(8,2) DEFAULT 92.00,
    default_overhead_pct        numeric(5,2) DEFAULT 18.0,
    default_margin_range_low    numeric(5,2) DEFAULT 25.0,
    default_margin_range_high   numeric(5,2) DEFAULT 40.0,

    -- Integrations
    payroll_connected               boolean DEFAULT false,
    payroll_provider                text,                       -- 'proservice_hi' | null
    payroll_api_key_encrypted       text,
    google_calendar_connected       boolean DEFAULT false,
    google_calendar_scope           text CHECK (google_calendar_scope IN ('read','denied') OR google_calendar_scope IS NULL),
    google_refresh_token_encrypted  text,
    brief_calendar_id               text,                       -- the "Brief" calendar in the user's Google account
    quickbooks_connected            boolean DEFAULT false,
    docusign_connected              boolean DEFAULT false,
    drive_connected                 boolean DEFAULT false,

    -- Voice (set by onboarding step 2)
    voice_sample_url            text,
    voice_sample_processed_at   timestamptz,
    voice_profile               jsonb,    -- {tone, preferred_terms, boilerplate_*}

    -- Onboarding state
    onboarding_completed_at     timestamptz,
    data_state                  text NOT NULL DEFAULT 'cold-start'
        CHECK (data_state IN ('cold-start','calibrating','calibrated')),

    created_at                  timestamptz NOT NULL DEFAULT now(),
    updated_at                  timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────────────────────────────────────────────────
-- memberships — user ↔ shop, with roles
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE memberships (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL,           -- references auth.users(id)
    shop_id     uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    role        text NOT NULL CHECK (role IN ('owner','admin','member')),
    invited_by  uuid,                    -- references auth.users(id), nullable for self-serve owner
    joined_at   timestamptz NOT NULL DEFAULT now(),
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, shop_id)
);

CREATE INDEX memberships_user_idx ON memberships (user_id);
CREATE INDEX memberships_shop_idx ON memberships (shop_id);

-- ───────────────────────────────────────────────────────────────────
-- invites — pending invitations (Settings → invite link)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE invites (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id     uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    email       text NOT NULL,
    role        text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
    token       text NOT NULL UNIQUE,
    invited_by  uuid NOT NULL,           -- references auth.users(id)
    expires_at  timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
    accepted_at timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX invites_token_idx ON invites (token) WHERE accepted_at IS NULL;
CREATE INDEX invites_shop_idx ON invites (shop_id);

-- ───────────────────────────────────────────────────────────────────
-- clients — people you bid for
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE clients (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id                 uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,

    name                    text NOT NULL,
    type                    text CHECK (type IN ('residential','commercial','gc','public') OR type IS NULL),
    primary_contact_name    text,
    primary_contact_email   text,
    primary_contact_phone   text,
    address_line            text,
    city                    text,
    state_code              text,   -- 'HI', 'CA', etc.
    notes                   text,

    -- Materialized rollups (refreshed by triggers on quotes)
    total_quoted            numeric(14,2) NOT NULL DEFAULT 0,
    total_won               numeric(14,2) NOT NULL DEFAULT 0,
    win_rate_pct            numeric(5,2),    -- null if total_quotes < 3
    last_activity_at        timestamptz,

    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX clients_shop_idx ON clients (shop_id);
CREATE INDEX clients_last_activity_idx ON clients (shop_id, last_activity_at DESC NULLS LAST);

-- ───────────────────────────────────────────────────────────────────
-- quotes — replaces bids
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE quotes (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id                 uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    client_id               uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,

    -- Display ref like "Q-2026-0042" — generated per shop+year
    ref                     text NOT NULL UNIQUE,

    -- Denormalized for fast list views
    client_name             text NOT NULL,
    client_contact_name     text,

    -- Project + scope
    project_title           text NOT NULL,
    project_address         text,
    scope_summary           text,           -- serif-rendered prose
    next_step               text,           -- "what's next" line on the agenda row

    -- Lifecycle
    state                   text NOT NULL DEFAULT 'DRAFT'
        CHECK (state IN ('DRAFT','SENT','AWAITING','RESPONDED','WON','LOST')),
    relationship            text CHECK (relationship IN ('new','referral','repeat') OR relationship IS NULL),

    -- Source (how did this quote start)
    source                  text CHECK (source IN ('upload','voice','manual','site_visit') OR source IS NULL),
    source_artifact_url     text,

    -- Money (kept as columns; line items live in their own table)
    total                   numeric(12,2) NOT NULL DEFAULT 0,
    margin_pct              numeric(5,2),

    -- Outcome capture (when LOST)
    outcome_competitor      text,
    outcome_winning_bid     numeric(12,2),
    outcome_captured_at     timestamptz,
    outcome_reason          text,

    -- Timestamps
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now(),
    sent_at                 timestamptz,
    responded_at            timestamptz
);

CREATE INDEX quotes_shop_state_idx ON quotes (shop_id, state);
CREATE INDEX quotes_shop_created_idx ON quotes (shop_id, created_at DESC);
CREATE INDEX quotes_client_idx ON quotes (client_id);

-- ───────────────────────────────────────────────────────────────────
-- quote_line_items — one row per line item, ordered
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE quote_line_items (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id        uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
    position        integer NOT NULL DEFAULT 0,          -- display order

    description     text NOT NULL,
    qty             numeric(12,3) NOT NULL DEFAULT 1,
    unit            text CHECK (unit IN ('each','hr','sqft','lf','cy','day','lump_sum') OR unit IS NULL),
    unit_price      numeric(12,2) NOT NULL DEFAULT 0,
    subtotal        numeric(12,2) NOT NULL DEFAULT 0,    -- qty × unit_price

    category        text CHECK (category IN ('labor','materials','subs','permits','equipment','other') OR category IS NULL),
    confidence      text CHECK (confidence IN ('high','med','low','manual') OR confidence IS NULL),
    source_excerpt  text,                                -- bit of source doc this came from

    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX quote_line_items_quote_idx ON quote_line_items (quote_id, position);

-- ───────────────────────────────────────────────────────────────────
-- quote_messages — Reply/Nudge drawer thread
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE quote_messages (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id        uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,

    direction       text NOT NULL CHECK (direction IN ('inbound','outbound')),
    channel         text NOT NULL CHECK (channel IN ('email','sms','manual')),
    subject         text,
    body            text NOT NULL,

    draft           boolean NOT NULL DEFAULT false,      -- outbound only
    draft_reasoning text,                                -- "Why this draft" copy
    drafted_by      text CHECK (drafted_by IN ('brief','user') OR drafted_by IS NULL),
    scheduled_for   timestamptz,                         -- null = send now (when not draft)

    sent_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX quote_messages_quote_idx ON quote_messages (quote_id, created_at);

-- ───────────────────────────────────────────────────────────────────
-- jobs — replaces job_cost_reconciliation header
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE jobs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id             uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    quote_id            uuid NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
    client_id           uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,

    ref                 text NOT NULL UNIQUE,    -- "J-2026-0017"

    -- Denorm for list views
    client_name         text NOT NULL,
    project_title       text NOT NULL,

    state               text NOT NULL DEFAULT 'SCHEDULED'
        CHECK (state IN ('SCHEDULED','INPROGRESS','CLOSED')),

    scheduled_start     date,
    actual_start        date,
    scheduled_end       date,
    actual_end          date,

    crew_ids            uuid[] NOT NULL DEFAULT '{}',    -- future: references people(id)
    crew_summary        text,                            -- "Iván + 2", free-text for now

    -- Totals (refreshed by triggers on job_cost_lines)
    estimated_total     numeric(12,2) NOT NULL DEFAULT 0,
    actual_total        numeric(12,2) NOT NULL DEFAULT 0,
    variance            numeric(12,2) NOT NULL DEFAULT 0,
    variance_pct        numeric(5,2),

    payroll_synced_at   timestamptz,

    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX jobs_shop_state_idx ON jobs (shop_id, state);
CREATE INDEX jobs_quote_idx ON jobs (quote_id);

-- ───────────────────────────────────────────────────────────────────
-- job_cost_lines — estimate vs actual per category
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE job_cost_lines (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id          uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

    category        text NOT NULL CHECK (category IN ('labor','materials','subs','permits','equipment','other')),
    description     text NOT NULL,

    estimated       numeric(12,2) NOT NULL DEFAULT 0,    -- from the original quote
    actual          numeric(12,2),                       -- null = not yet reconciled

    source          text CHECK (source IN ('payroll','receipts','manual') OR source IS NULL),
    note            text,

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX job_cost_lines_job_idx ON job_cost_lines (job_id);

-- ───────────────────────────────────────────────────────────────────
-- events — lightweight audit / activity feed
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE events (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id     uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    quote_id    uuid REFERENCES quotes(id) ON DELETE CASCADE,
    job_id      uuid REFERENCES jobs(id) ON DELETE CASCADE,

    type        text NOT NULL,    -- 'quote.sent', 'quote.opened', 'quote.responded', 'nudge.sent', 'job.closed', ...
    actor       text,             -- 'brief' | 'user' | email
    payload     jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_shop_created_idx ON events (shop_id, created_at DESC);
CREATE INDEX events_quote_idx ON events (quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX events_job_idx ON events (job_id) WHERE job_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────
-- Triggers: updated_at
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER shops_touch_updated_at         BEFORE UPDATE ON shops         FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER clients_touch_updated_at       BEFORE UPDATE ON clients       FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER quotes_touch_updated_at        BEFORE UPDATE ON quotes        FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER jobs_touch_updated_at          BEFORE UPDATE ON jobs          FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER job_cost_lines_touch_updated   BEFORE UPDATE ON job_cost_lines FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ───────────────────────────────────────────────────────────────────
-- Trigger: refresh shops.data_state when quote count changes
-- (cold-start: 0 quotes; calibrating: 1-5 OR <14d from first quote;
--  calibrated: >5 AND ≥14d. Per design/spec/empty-states.md.)
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_shop_data_state(shop uuid) RETURNS void AS $$
DECLARE
    n_quotes integer;
    first_quote_at timestamptz;
    new_state text;
BEGIN
    SELECT COUNT(*), MIN(created_at) INTO n_quotes, first_quote_at
    FROM quotes WHERE shop_id = shop;

    IF n_quotes = 0 THEN
        new_state := 'cold-start';
    ELSIF n_quotes > 5 AND first_quote_at < (now() - interval '14 days') THEN
        new_state := 'calibrated';
    ELSE
        new_state := 'calibrating';
    END IF;

    UPDATE shops SET data_state = new_state WHERE id = shop AND data_state IS DISTINCT FROM new_state;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION quote_data_state_trigger() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM refresh_shop_data_state(OLD.shop_id);
        RETURN OLD;
    ELSE
        PERFORM refresh_shop_data_state(NEW.shop_id);
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quotes_refresh_data_state
    AFTER INSERT OR DELETE ON quotes
    FOR EACH ROW EXECUTE FUNCTION quote_data_state_trigger();

-- ───────────────────────────────────────────────────────────────────
-- Trigger: refresh client rollups when quotes change
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_client_rollups(c uuid) RETURNS void AS $$
DECLARE
    quoted numeric(14,2);
    won numeric(14,2);
    n_quotes integer;
    n_decided integer;
    n_won integer;
    last_at timestamptz;
BEGIN
    SELECT
        COALESCE(SUM(total), 0),
        COALESCE(SUM(total) FILTER (WHERE state = 'WON'), 0),
        COUNT(*),
        COUNT(*) FILTER (WHERE state IN ('WON','LOST')),
        COUNT(*) FILTER (WHERE state = 'WON'),
        MAX(GREATEST(updated_at, COALESCE(responded_at, created_at), COALESCE(sent_at, created_at)))
    INTO quoted, won, n_quotes, n_decided, n_won, last_at
    FROM quotes WHERE client_id = c;

    UPDATE clients SET
        total_quoted = quoted,
        total_won = won,
        win_rate_pct = CASE WHEN n_decided >= 3 THEN ROUND((n_won::numeric / NULLIF(n_decided, 0)) * 100, 2) ELSE NULL END,
        last_activity_at = last_at
    WHERE id = c;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION quote_client_rollup_trigger() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM refresh_client_rollups(OLD.client_id);
        RETURN OLD;
    ELSE
        PERFORM refresh_client_rollups(NEW.client_id);
        IF TG_OP = 'UPDATE' AND OLD.client_id IS DISTINCT FROM NEW.client_id THEN
            PERFORM refresh_client_rollups(OLD.client_id);
        END IF;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER quotes_refresh_client_rollups
    AFTER INSERT OR UPDATE OR DELETE ON quotes
    FOR EACH ROW EXECUTE FUNCTION quote_client_rollup_trigger();

-- ───────────────────────────────────────────────────────────────────
-- Trigger: refresh job totals when cost lines change
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_job_totals(j uuid) RETURNS void AS $$
DECLARE
    est numeric(12,2);
    act numeric(12,2);
    var numeric(12,2);
    var_pct numeric(5,2);
BEGIN
    SELECT
        COALESCE(SUM(estimated), 0),
        COALESCE(SUM(actual) FILTER (WHERE actual IS NOT NULL), 0)
    INTO est, act
    FROM job_cost_lines WHERE job_id = j;

    var := act - est;
    var_pct := CASE WHEN est > 0 THEN ROUND((var / est) * 100, 2) ELSE NULL END;

    UPDATE jobs SET
        estimated_total = est,
        actual_total = act,
        variance = var,
        variance_pct = var_pct
    WHERE id = j;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION job_cost_lines_totals_trigger() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM refresh_job_totals(OLD.job_id);
        RETURN OLD;
    ELSE
        PERFORM refresh_job_totals(NEW.job_id);
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER job_cost_lines_refresh_totals
    AFTER INSERT OR UPDATE OR DELETE ON job_cost_lines
    FOR EACH ROW EXECUTE FUNCTION job_cost_lines_totals_trigger();

-- ───────────────────────────────────────────────────────────────────
-- Helper: current_shop_id() — resolves auth.uid() → memberships.shop_id
-- Returns the FIRST membership for the user. v1 has one shop per user
-- so this is unambiguous; multi-shop UX is a future addition.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_shop_id() RETURNS uuid AS $$
    SELECT shop_id FROM memberships
    WHERE user_id = auth.uid()
    ORDER BY joined_at ASC
    LIMIT 1
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ───────────────────────────────────────────────────────────────────
-- Row-Level Security
-- Every tenant table: read+write iff shop_id is in the user's memberships.
-- service_role bypasses RLS by default (used by server-only API routes
-- that need cross-tenant access, e.g. cron jobs).
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE shops             ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships       ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites           ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients           ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_line_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_messages    ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_cost_lines    ENABLE ROW LEVEL SECURITY;
ALTER TABLE events            ENABLE ROW LEVEL SECURITY;

-- shops: a user can see/update their own shops (joined via memberships)
CREATE POLICY shops_member_select ON shops FOR SELECT
    USING (id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid()));
CREATE POLICY shops_member_update ON shops FOR UPDATE
    USING (id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid() AND role IN ('owner','admin')));
-- INSERT: handled via service_role from the auth callback (creates shop + owner membership atomically)
-- DELETE: service_role only

-- memberships: a user sees their own + admins see all their shop's
CREATE POLICY memberships_self_select ON memberships FOR SELECT
    USING (user_id = auth.uid() OR shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid() AND role IN ('owner','admin')));
CREATE POLICY memberships_admin_write ON memberships FOR ALL
    USING (shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid() AND role IN ('owner','admin')))
    WITH CHECK (shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid() AND role IN ('owner','admin')));

-- invites: admins of the shop can read/write
CREATE POLICY invites_admin_all ON invites FOR ALL
    USING (shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid() AND role IN ('owner','admin')))
    WITH CHECK (shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid() AND role IN ('owner','admin')));

-- Standard tenant pattern: all members can read+write within shop
CREATE POLICY clients_tenant_all ON clients FOR ALL
    USING (shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid()))
    WITH CHECK (shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid()));

CREATE POLICY quotes_tenant_all ON quotes FOR ALL
    USING (shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid()))
    WITH CHECK (shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid()));

-- quote_line_items: tied to quote.shop_id (resolved via JOIN in policy)
CREATE POLICY quote_line_items_tenant_all ON quote_line_items FOR ALL
    USING (quote_id IN (SELECT id FROM quotes WHERE shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid())))
    WITH CHECK (quote_id IN (SELECT id FROM quotes WHERE shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid())));

CREATE POLICY quote_messages_tenant_all ON quote_messages FOR ALL
    USING (quote_id IN (SELECT id FROM quotes WHERE shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid())))
    WITH CHECK (quote_id IN (SELECT id FROM quotes WHERE shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid())));

CREATE POLICY jobs_tenant_all ON jobs FOR ALL
    USING (shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid()))
    WITH CHECK (shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid()));

CREATE POLICY job_cost_lines_tenant_all ON job_cost_lines FOR ALL
    USING (job_id IN (SELECT id FROM jobs WHERE shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid())))
    WITH CHECK (job_id IN (SELECT id FROM jobs WHERE shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid())));

CREATE POLICY events_tenant_all ON events FOR ALL
    USING (shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid()))
    WITH CHECK (shop_id IN (SELECT shop_id FROM memberships WHERE user_id = auth.uid()));

-- ───────────────────────────────────────────────────────────────────
-- Notes
-- ───────────────────────────────────────────────────────────────────
-- 1. Supabase Storage buckets ('quote-artifacts', 'voice-samples',
--    'shop-branding') are configured via the dashboard, not SQL. Bucket
--    policies should mirror the table RLS — file path prefixed with shop_id.
--
-- 2. The auth callback (web/src/pages/auth/callback.astro in PR 3) is
--    responsible for atomically creating shops + memberships rows on first
--    sign-in. Run that as service_role to bypass RLS during bootstrap.
--
-- 3. Quote ref / job ref ("Q-2026-0042", "J-2026-0017") are generated
--    application-side from a per-shop sequence — kept out of SQL so the
--    format can change without a migration.
