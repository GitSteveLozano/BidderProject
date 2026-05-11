-- 0002: audit log for bid mutations.
-- Append-only record of who/what/when changed any bid-related row.
-- Useful for trust + debugging + reconciliation of "wait, why did
-- this bid's pricing change two weeks ago?"

CREATE TABLE IF NOT EXISTS audit_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    occurred_at     TIMESTAMPTZ DEFAULT NOW(),
    entity_type     TEXT NOT NULL,   -- 'bid' | 'follow_up' | 'reconciliation' | 'insight' | ...
    entity_id       UUID,
    company_id      UUID,
    action          TEXT NOT NULL,   -- 'create' | 'update' | 'transition' | 'reconcile' | ...
    actor           TEXT,            -- 'human' | 'orchestrator' | 'jcr_agent' | 'intelligence_agent' | ...
    request_id      TEXT,            -- from core.logging.current_request_id()
    agent_call_id   UUID,            -- from core.logging.current_agent_call_id()
    diff            JSONB,           -- {field: {from, to}, ...} or freeform payload
    notes           TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity
    ON audit_log (entity_type, entity_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_company
    ON audit_log (company_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_request
    ON audit_log (request_id) WHERE request_id IS NOT NULL;
