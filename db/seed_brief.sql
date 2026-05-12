-- Brief — demo seed
-- One shop ("L·A Stucco") + 2 clients + 6 quotes + 2 jobs + some events.
-- Persona: Cavy from design/spec/data.jsx. Used for screenshots, demo,
-- local development.
--
-- Run AFTER 001_brief_schema.sql against a fresh Supabase project (as
-- postgres / service_role — bypasses RLS).
--
-- To work against this seed in the UI, sign in via Google, then run:
--   INSERT INTO memberships (user_id, shop_id, role)
--   VALUES ('<your auth.uid>', '00000000-0000-4000-8000-000000000001', 'owner');
-- (Or use db/link_demo_user.sql which does that lookup automatically.)

-- ───────────────────────────────────────────────────────────────────
-- Idempotency: nuke anything that points at the demo shop first.
-- safe to re-run.
-- ───────────────────────────────────────────────────────────────────
DELETE FROM events           WHERE shop_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM job_cost_lines   WHERE job_id IN (SELECT id FROM jobs WHERE shop_id = '00000000-0000-4000-8000-000000000001');
DELETE FROM jobs             WHERE shop_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM quote_messages   WHERE quote_id IN (SELECT id FROM quotes WHERE shop_id = '00000000-0000-4000-8000-000000000001');
DELETE FROM quote_line_items WHERE quote_id IN (SELECT id FROM quotes WHERE shop_id = '00000000-0000-4000-8000-000000000001');
DELETE FROM quotes           WHERE shop_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM clients          WHERE shop_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM memberships      WHERE shop_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM invites          WHERE shop_id = '00000000-0000-4000-8000-000000000001';
DELETE FROM shops            WHERE id      = '00000000-0000-4000-8000-000000000001';

-- ───────────────────────────────────────────────────────────────────
-- shop
-- ───────────────────────────────────────────────────────────────────
INSERT INTO shops (
    id, legal_name, trade_name, owner_name, owner_email,
    license_number, license_jurisdiction, license_classification,
    default_markup_pct, default_labor_rate, default_overhead_pct,
    default_margin_range_low, default_margin_range_high,
    payroll_connected, payroll_provider,
    google_calendar_connected, google_calendar_scope, brief_calendar_id,
    voice_profile, onboarding_completed_at, data_state
) VALUES (
    '00000000-0000-4000-8000-000000000001',
    'L·A Stucco LLC', 'L·A Stucco', 'Carlos ''Cavy'' Alvarado', 'cavy@lastucco.example',
    'C-35 #1089342', 'CA', 'C-35 Lathing and Plastering',
    32.0, 58.00, 18.0, 25.0, 40.0,
    true, 'proservice_hi',
    true, 'read', 'briefcal_demo_001',
    jsonb_build_object(
        'tone', 'direct, operational, builder-to-builder',
        'preferred_terms', ARRAY['scratch coat', 'brown coat', 'sand-float', 'elevation', 'crew'],
        'avoided_terms', ARRAY['leverage', 'synergy', 'unlock value'],
        'boilerplate_intro', 'Thanks for getting the package over. Here''s what we''ve got.',
        'boilerplate_closing', 'Holler with questions. — Cavy'
    ),
    now() - interval '32 days',
    'calibrated'
);

-- ───────────────────────────────────────────────────────────────────
-- clients
-- ───────────────────────────────────────────────────────────────────
INSERT INTO clients (
    id, shop_id, name, type, primary_contact_name, primary_contact_email,
    address_line, city, state_code, notes
) VALUES
    ('00000000-0000-4000-8000-000000000101',
     '00000000-0000-4000-8000-000000000001',
     'Halsted & Sons Contracting', 'gc', 'Diane Halsted', 'diane@halstedcontracting.example',
     '418 Ridgemoor Ln', 'Pasadena', 'CA',
     'Repeat client. Always pulls own permits. Prefers sand-float, integral pigment.'),
    ('00000000-0000-4000-8000-000000000102',
     '00000000-0000-4000-8000-000000000001',
     'Vermont Modern LLC', 'residential', 'Priya Shah', 'priya@vermontmodern.example',
     '1822 Vermont Ave', 'Glendale', 'CA',
     'Cold lead from McKenzie GC referral. Two-story addition, design-build style.'),
    ('00000000-0000-4000-8000-000000000103',
     '00000000-0000-4000-8000-000000000001',
     'GC Pacific Builders', 'gc', 'Marco Ruiz', 'marco@gcpacific.example',
     '229 W Olive', 'Burbank', 'CA',
     '11 jobs over 3 years. Marco bids Fridays — no Thursday calls.'),
    ('00000000-0000-4000-8000-000000000104',
     '00000000-0000-4000-8000-000000000001',
     'Westside Restoration', 'commercial', 'Tom Beckett', 'tom@westside.example',
     '642 Marine Ave', 'Santa Monica', 'CA',
     'Heritage façade specialist. Tight tolerances. Worth the slow communication.');

-- ───────────────────────────────────────────────────────────────────
-- quotes — 6 quotes covering all states
-- ───────────────────────────────────────────────────────────────────
INSERT INTO quotes (
    id, shop_id, client_id, ref, client_name, client_contact_name,
    project_title, project_address, scope_summary, next_step,
    state, relationship, source,
    total, margin_pct,
    outcome_competitor, outcome_winning_bid, outcome_captured_at,
    sent_at, responded_at, created_at
) VALUES
    -- RESPONDED — top of agenda
    ('00000000-0000-4000-8000-000000000201',
     '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000101',
     'Q-2026-0184', 'Halsted & Sons Contracting', 'Diane Halsted',
     'Spec home — 3-coat stucco re-do', '418 Ridgemoor Ln, Pasadena',
     'Strip + lath repair + scratch/brown/finish coats with sand-float, integral pigment, across two elevations (~4,200 sqft).',
     'Diane asked about a smoother sand-float finish — call back today',
     'RESPONDED', 'repeat', 'upload',
     38420.00, 31.0,
     NULL, NULL, NULL,
     now() - interval '5 days', now() - interval '1 day',
     now() - interval '5 days'),

    -- AWAITING — gone quiet
    ('00000000-0000-4000-8000-000000000202',
     '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000102',
     'Q-2026-0183', 'Vermont Modern LLC', 'Priya Shah',
     'Two-story addition · scratch + brown coat', '1822 Vermont Ave, Glendale',
     'New two-story addition (~1,850 sqft). Standard scratch and brown over wire lath.',
     'Follow up — Priya hasn''t opened the PDF since Friday',
     'AWAITING', 'new', 'manual',
     22150.00, 27.0,
     NULL, NULL, NULL,
     now() - interval '7 days', NULL,
     now() - interval '7 days'),

    -- SENT — recent, no movement yet
    ('00000000-0000-4000-8000-000000000203',
     '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000103',
     'Q-2026-0182', 'GC Pacific Builders', 'Marco Ruiz',
     '5-unit ADU complex — full stucco', '229 W Olive, Burbank',
     '5-unit ADU. Full scratch/brown/finish, ~7,400 sqft, acrylic finish per architect.',
     'Marco bids Fridays — nothing today',
     'SENT', 'repeat', 'upload',
     71800.00, 29.0,
     NULL, NULL, NULL,
     now() - interval '2 days', NULL,
     now() - interval '2 days'),

    -- WON
    ('00000000-0000-4000-8000-000000000204',
     '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000104',
     'Q-2026-0181', 'Westside Restoration', 'Tom Beckett',
     'Mediterranean façade repair · 2 elevations', '642 Marine Ave, Santa Monica',
     'Restore Mediterranean façade across two elevations. Lath/paper repair, hand-troweled finish.',
     'Starts May 18',
     'WON', 'repeat', 'site_visit',
     14200.00, 34.0,
     NULL, NULL, NULL,
     now() - interval '17 days', now() - interval '10 days',
     now() - interval '20 days'),

    -- LOST
    ('00000000-0000-4000-8000-000000000205',
     '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000102',
     'Q-2026-0180', 'Vermont Modern LLC', 'Priya Shah',
     'Custom home · acrylic finish 7000 sqft', '8 Mulholland Crest, Los Angeles',
     'Custom home, full façade acrylic finish.',
     'Lost to Pacific Plastering — $11K under',
     'LOST', 'new', 'manual',
     88600.00, 22.0,
     'Pacific Plastering', 77450.00, now() - interval '14 days',
     now() - interval '23 days', now() - interval '14 days',
     now() - interval '25 days'),

    -- DRAFT
    ('00000000-0000-4000-8000-000000000206',
     '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000101',
     'Q-2026-0185', 'Halsted & Sons Contracting', 'Diane Halsted',
     'Garage conversion patch + texture match', '418 Ridgemoor Ln, Pasadena',
     'Small patch + match existing texture. ~480 sqft.',
     'Draft ready — review crew availability',
     'DRAFT', 'repeat', 'voice',
     4850.00, 38.0,
     NULL, NULL, NULL,
     NULL, NULL,
     now() - interval '1 day');

-- ───────────────────────────────────────────────────────────────────
-- quote_line_items — one realistic set for the top quote
-- ───────────────────────────────────────────────────────────────────
INSERT INTO quote_line_items (quote_id, position, description, qty, unit, unit_price, subtotal, category, confidence)
VALUES
    ('00000000-0000-4000-8000-000000000201', 1, 'Strip existing finish, dispose at site',          4200, 'sqft', 1.40,  5880.00, 'labor',     'high'),
    ('00000000-0000-4000-8000-000000000201', 2, 'Repair lath + 60-min paper, replace damaged',     4200, 'sqft', 1.10,  4620.00, 'labor',     'high'),
    ('00000000-0000-4000-8000-000000000201', 3, 'Scratch coat, 7/8" application',                  4200, 'sqft', 1.40,  5880.00, 'labor',     'high'),
    ('00000000-0000-4000-8000-000000000201', 4, 'Brown coat, hand-troweled',                       4200, 'sqft', 1.30,  5460.00, 'labor',     'high'),
    ('00000000-0000-4000-8000-000000000201', 5, 'Sand-float finish with integral color',           4200, 'sqft', 1.60,  6720.00, 'labor',     'high'),
    ('00000000-0000-4000-8000-000000000201', 6, 'Materials — cement, lime, sand, mesh, accessories', 1,  'lump_sum', 7920.00, 7920.00, 'materials', 'med'),
    ('00000000-0000-4000-8000-000000000201', 7, 'Scaffolding (5 weeks)',                             1,  'lump_sum', 1940.00, 1940.00, 'equipment', 'med');

-- ───────────────────────────────────────────────────────────────────
-- jobs — 2 jobs (1 in progress, 1 closed)
-- ───────────────────────────────────────────────────────────────────
INSERT INTO jobs (
    id, shop_id, quote_id, client_id, ref,
    client_name, project_title, state,
    scheduled_start, actual_start, scheduled_end,
    crew_summary, payroll_synced_at, created_at
) VALUES
    -- In progress
    ('00000000-0000-4000-8000-000000000301',
     '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000204',
     '00000000-0000-4000-8000-000000000104',
     'J-2026-0142',
     'Westside Restoration', 'Marine Ave façade', 'INPROGRESS',
     CURRENT_DATE - 8, CURRENT_DATE - 8, CURRENT_DATE + 4,
     'Iván + 2', now() - interval '1 day',
     now() - interval '9 days'),
    -- Closed
    ('00000000-0000-4000-8000-000000000302',
     '00000000-0000-4000-8000-000000000001',
     '00000000-0000-4000-8000-000000000204',
     '00000000-0000-4000-8000-000000000101',
     'J-2026-0141',
     'Halsted & Sons Contracting', 'Ridgemoor garage', 'CLOSED',
     CURRENT_DATE - 30, CURRENT_DATE - 30, CURRENT_DATE - 22,
     'Iván + 1', now() - interval '7 days',
     now() - interval '32 days');

-- Job cost lines for the closed job (so totals + variance render)
INSERT INTO job_cost_lines (job_id, category, description, estimated, actual, source)
VALUES
    ('00000000-0000-4000-8000-000000000302', 'labor',     'Crew hours · stucco + finisher', 1856.00, 2784.00, 'payroll'),
    ('00000000-0000-4000-8000-000000000302', 'materials', 'Cement + sand + mesh',            950.00, 1240.00, 'receipts'),
    ('00000000-0000-4000-8000-000000000302', 'other',     'Disposal + permit',               240.00,  280.00, 'manual');

-- Job cost lines for the in-progress job (estimates only)
INSERT INTO job_cost_lines (job_id, category, description, estimated, actual, source)
VALUES
    ('00000000-0000-4000-8000-000000000301', 'labor',     'Crew hours',           5568.00, 3712.00, 'payroll'),
    ('00000000-0000-4000-8000-000000000301', 'materials', 'Stucco + lath repair', 3200.00, 2880.00, 'receipts'),
    ('00000000-0000-4000-8000-000000000301', 'equipment', 'Scaffolding (rental)',  870.00, 870.00, 'manual');

-- ───────────────────────────────────────────────────────────────────
-- events — a few activity-feed entries
-- ───────────────────────────────────────────────────────────────────
INSERT INTO events (shop_id, quote_id, type, actor, payload, created_at) VALUES
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000204', 'quote.sent',      'user',  '{}'::jsonb, now() - interval '17 days'),
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000204', 'quote.opened',    'brief', '{"count":3}'::jsonb, now() - interval '15 days'),
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000204', 'quote.responded', 'brief', '{}'::jsonb, now() - interval '12 days'),
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000204', 'quote.won',       'user',  '{}'::jsonb, now() - interval '10 days'),
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000201', 'quote.sent',      'user',  '{}'::jsonb, now() - interval '5 days'),
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000201', 'quote.opened',    'brief', '{"count":2}'::jsonb, now() - interval '3 days'),
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000201', 'quote.responded', 'brief', '{"summary":"client asked about sand-float finish"}'::jsonb, now() - interval '1 day'),
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000203', 'quote.sent',      'user',  '{}'::jsonb, now() - interval '2 days'),
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000205', 'quote.lost',      'user',  '{"competitor":"Pacific Plastering","delta_usd":-11150}'::jsonb, now() - interval '14 days');

-- ───────────────────────────────────────────────────────────────────
-- Sanity: recompute trigger-managed columns (in case triggers misfired
-- during the bulk insert, this is a no-op if they did fire correctly).
-- ───────────────────────────────────────────────────────────────────
SELECT refresh_shop_data_state('00000000-0000-4000-8000-000000000001');
SELECT refresh_client_rollups(id) FROM clients WHERE shop_id = '00000000-0000-4000-8000-000000000001';
SELECT refresh_job_totals(id)     FROM jobs    WHERE shop_id = '00000000-0000-4000-8000-000000000001';
