-- 002_quote_messages_sender.sql
--
-- Inbound messages need to record who the email came from. We didn't
-- model this in the initial schema because outbound-only didn't need
-- it. Adding nullable columns is non-breaking; outbound rows continue
-- to be inserted without these fields set.
--
-- Run this once in the Supabase SQL editor.

ALTER TABLE quote_messages
  ADD COLUMN IF NOT EXISTS sender_email text,
  ADD COLUMN IF NOT EXISTS sender_name  text;
