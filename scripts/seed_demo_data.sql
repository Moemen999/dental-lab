-- =============================================================================
-- Seed Demo Data for Dental Laboratory Case Management System
-- =============================================================================
-- This script inserts realistic sample data for dentists, delivery batches,
-- cases, and operational events for testing workflows.
-- =============================================================================

-- 1. Insert External Dentists & Clinics
INSERT INTO dentists (id, name, clinic_name, phone, email, address, notes, is_active)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'Dr. Sarah Mitchell', 'Apex Dental Arts', '+1 555-0101', 'mitchell@apexdental.com', '124 Market St, Suite 400', 'Prefers A2 and A3 anterior zirconia crowns', true),
  ('22222222-2222-2222-2222-222222222222', 'Dr. Robert Chen', 'Metropolitan Smiles', '+1 555-0102', 'chen@metrosmiles.com', '789 Highland Ave', 'Requests 0.5mm clearance for posterior onlays', true),
  ('33333333-3333-3333-3333-333333333333', 'Dr. Elena Rostova', 'Grand Central Prosthodontics', '+1 555-0103', 'rostova@gcprostho.com', '45 Grand St', 'Full mouth rehabilitation cases', true),
  ('44444444-4444-4444-4444-444444444444', 'Dr. James Wilson', 'Harbor View Dental Care', '+1 555-0104', 'wilson@harbordental.com', '12 Ocean Blvd', 'Night guards and clear retainers', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Insert Intake Delivery Batch (Representative handoff to Reception)
INSERT INTO delivery_batches (id, batch_reference, batch_type, status, expected_count, actual_count, handoff_at, notes)
VALUES
  ('bbbbbbbb-1111-1111-1111-111111111111', 'BATCH-202610-INT-001', 'intake', 'open', 3, 3, now() - INTERVAL '3 days', 'Morning collection from Dr. Mitchell and Dr. Chen')
ON CONFLICT (batch_reference) DO NOTHING;

-- 3. Insert Initial Cases
INSERT INTO cases (
  id, case_number, patient_name, patient_age, dentist_id, case_type, tooth_number, shade,
  description, current_status, priority, date_received, due_date, intake_batch_id
)
VALUES
  (
    'cccccccc-1111-1111-1111-111111111111',
    'CASE-202610-00001',
    'David Miller',
    42,
    '11111111-1111-1111-1111-111111111111',
    'Crown',
    '14',
    'A2',
    'Zirconia monolithic posterior crown',
    'in_progress',
    'normal',
    now() - INTERVAL '3 days',
    (now() + INTERVAL '4 days')::date,
    'bbbbbbbb-1111-1111-1111-111111111111'
  ),
  (
    'cccccccc-2222-2222-2222-222222222222',
    'CASE-202610-00002',
    'Emily Clarke',
    29,
    '22222222-2222-2222-2222-222222222222',
    'Veneer',
    '8, 9',
    'BL2',
    'E-max aesthetic anterior veneers',
    'assigned',
    'high',
    now() - INTERVAL '2 days',
    (now() + INTERVAL '3 days')::date,
    'bbbbbbbb-1111-1111-1111-111111111111'
  ),
  (
    'cccccccc-3333-3333-3333-333333333333',
    'CASE-202610-00003',
    'Arthur Pendelton',
    64,
    '33333333-3333-3333-3333-333333333333',
    'Denture - Partial',
    'Lower Arch',
    'A3',
    'Cast metal framework with acrylic saddles',
    'awaiting_assignment',
    'normal',
    now() - INTERVAL '1 day',
    (now() + INTERVAL '7 days')::date,
    'bbbbbbbb-1111-1111-1111-111111111111'
  ),
  (
    'cccccccc-4444-4444-4444-444444444444',
    'CASE-202610-00004',
    'Sophia Nguyen',
    35,
    '44444444-4444-4444-4444-444444444444',
    'Night Guard',
    'Upper Arch',
    NULL,
    'Dual-laminate hard/soft comfort guard',
    'awaiting_representative_pickup',
    'normal',
    now() - INTERVAL '4 days',
    (now() + INTERVAL '1 day')::date,
    NULL
  )
ON CONFLICT (case_number) DO NOTHING;

-- 4. Associate cases with delivery batch
INSERT INTO batch_cases (batch_id, case_id)
VALUES
  ('bbbbbbbb-1111-1111-1111-111111111111', 'cccccccc-1111-1111-1111-111111111111'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'cccccccc-2222-2222-2222-222222222222'),
  ('bbbbbbbb-1111-1111-1111-111111111111', 'cccccccc-3333-3333-3333-333333333333')
ON CONFLICT (batch_id, case_id) DO NOTHING;
