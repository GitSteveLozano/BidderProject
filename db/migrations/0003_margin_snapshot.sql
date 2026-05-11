-- 0003: nightly margin snapshot for fast heatmap renders.
--
-- The Intelligence Dashboard's margin-by-service-line heatmap aggregates
-- `job_cost_reconciliation` × `bids` by (service_line, quarter). With
-- ~40 bids the live query is instant; with ~10k it's a noticeable wait.
--
-- This materialized view precomputes the aggregate. The Celery task
-- `materialize_margin_snapshots_nightly` refreshes it every 24h via
-- `REFRESH MATERIALIZED VIEW CONCURRENTLY`. The UI prefers the
-- materialized view when present and falls back to the live query if
-- it doesn't exist yet (migration unapplied).

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

-- Unique index so REFRESH MATERIALIZED VIEW CONCURRENTLY works.
CREATE UNIQUE INDEX IF NOT EXISTS idx_margin_snapshot_pk
    ON margin_snapshot_quarterly (company_id, service_line, quarter);

CREATE INDEX IF NOT EXISTS idx_margin_snapshot_company
    ON margin_snapshot_quarterly (company_id, quarter);
