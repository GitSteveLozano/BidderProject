-- 005_client_contacts.sql
--
-- Multi-contact support for clients. The original schema modeled a
-- single primary_contact_{name,email,phone} on clients, which doesn't
-- match how operators actually send quotes: a company project usually
-- has a decision-maker + project manager + AP person, and quotes need
-- to land in all three inboxes.
--
-- This table holds the extended contact list. clients.primary_contact_*
-- stays as denormalized fast-path; new code reads client_contacts when
-- present and falls back to primary_contact_* otherwise.
--
-- `always_notify` flips the contact into the default recipient set
-- for every outbound from that client. The per-quote recipient picker
-- pre-checks these; operators can adjust per send.
--
-- Run this once in the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS client_contacts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  name            text,
  email           text,
  phone           text,
  title           text,                            -- "Owner", "PM", "AP"

  is_primary      boolean NOT NULL DEFAULT false,
  always_notify   boolean NOT NULL DEFAULT false,

  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_contacts_client_idx ON client_contacts (client_id);

ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;

-- Inherit tenancy from the parent client (which is gated by shop_id).
CREATE POLICY client_contacts_tenant_all ON client_contacts
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_contacts.client_id
        AND c.shop_id = current_shop_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clients c
      WHERE c.id = client_contacts.client_id
        AND c.shop_id = current_shop_id()
    )
  );

CREATE TRIGGER client_contacts_touch_updated_at
  BEFORE UPDATE ON client_contacts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
