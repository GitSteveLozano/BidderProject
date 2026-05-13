-- 006_change_orders.sql
--
-- Change orders for jobs. Industry-standard scope-change flow: the
-- crew runs into something not in the original bid (rotten sheathing,
-- different color spec, owner adds a wall), the contractor writes it
-- up, the client approves it, and the job's contracted total goes up.
--
-- Modeled as a sibling to quotes — its own ref (CO-2026-0017), its
-- own line items, its own state machine (PROPOSED → SENT → APPROVED |
-- REJECTED | VOID).
--
-- jobs.change_order_total is a derived column refreshed by triggers
-- when approved COs land. The Jobs detail screen shows
-- estimated_total (the original bid) + change_order_total (the
-- approved adds), so variance math reflects the true contracted
-- number.
--
-- Run this once in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS change_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  job_id          uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,

  ref             text NOT NULL UNIQUE,
  title           text NOT NULL,
  reason          text,                            -- why this CO exists

  state           text NOT NULL DEFAULT 'PROPOSED'
      CHECK (state IN ('PROPOSED','SENT','APPROVED','REJECTED','VOID')),

  total           numeric(12,2) NOT NULL DEFAULT 0,
  margin_pct      numeric(5,2),

  sent_at         timestamptz,
  responded_at    timestamptz,
  approved_at     timestamptz,
  rejected_at     timestamptz,
  rejected_reason text,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS change_orders_job_idx ON change_orders (job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS change_orders_shop_state_idx ON change_orders (shop_id, state);

CREATE TABLE IF NOT EXISTS change_order_line_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_order_id   uuid NOT NULL REFERENCES change_orders(id) ON DELETE CASCADE,
  position          integer NOT NULL DEFAULT 0,

  description       text NOT NULL,
  qty               numeric(12,3) NOT NULL DEFAULT 1,
  unit              text CHECK (unit IN ('each','hr','sqft','lf','cy','day','lump_sum') OR unit IS NULL),
  unit_price        numeric(12,2) NOT NULL DEFAULT 0,
  subtotal          numeric(12,2) NOT NULL DEFAULT 0,

  category          text CHECK (category IN ('labor','materials','subs','permits','equipment','other') OR category IS NULL),
  margin_pct        numeric(5,2),

  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS change_order_line_items_co_idx
  ON change_order_line_items (change_order_id, position);

-- Denormalized rollup on jobs: sum of `total` across APPROVED COs.
-- Refreshed by a trigger whenever a CO transitions in or out of
-- APPROVED state.
ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS change_order_total numeric(12,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION refresh_job_change_order_total() RETURNS trigger AS $$
DECLARE
  affected_job_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    affected_job_id := OLD.job_id;
  ELSE
    affected_job_id := NEW.job_id;
  END IF;

  UPDATE jobs
     SET change_order_total = COALESCE((
       SELECT SUM(total) FROM change_orders
        WHERE job_id = affected_job_id AND state = 'APPROVED'
     ), 0)
   WHERE id = affected_job_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS change_orders_refresh_job_rollup ON change_orders;
CREATE TRIGGER change_orders_refresh_job_rollup
  AFTER INSERT OR UPDATE OR DELETE ON change_orders
  FOR EACH ROW EXECUTE FUNCTION refresh_job_change_order_total();

-- RLS
ALTER TABLE change_orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_order_line_items  ENABLE ROW LEVEL SECURITY;

CREATE POLICY change_orders_tenant_all ON change_orders
  FOR ALL
  USING (shop_id = current_shop_id())
  WITH CHECK (shop_id = current_shop_id());

CREATE POLICY change_order_line_items_tenant_all ON change_order_line_items
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM change_orders co
      WHERE co.id = change_order_line_items.change_order_id
        AND co.shop_id = current_shop_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM change_orders co
      WHERE co.id = change_order_line_items.change_order_id
        AND co.shop_id = current_shop_id()
    )
  );

CREATE TRIGGER change_orders_touch_updated_at
  BEFORE UPDATE ON change_orders
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
