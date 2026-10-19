-- =============================================================================
-- Dental Laboratory Case Management System
-- Complete Database Schema Migration
-- =============================================================================
-- This migration creates all tables, constraints, indexes, functions, triggers,
-- and RLS policies for the dental case management system.
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- CUSTOM TYPES
-- =============================================================================

-- Application roles
CREATE TYPE app_role AS ENUM ('owner', 'representative', 'receptionist', 'technician');

-- Account status
CREATE TYPE account_status AS ENUM ('active', 'inactive', 'pending_invitation');

-- Case status - the full state machine
CREATE TYPE case_status AS ENUM (
  'intake_pending',
  'registered',
  'awaiting_assignment',
  'assigned',
  'in_progress',
  'completed',
  'awaiting_reception_receipt',
  'received_by_reception',
  'awaiting_representative_pickup',
  'with_representative',
  'delivered',
  'on_hold',
  'rework_required',
  'cancelled'
);

-- Batch type
CREATE TYPE batch_type AS ENUM ('intake', 'return');

-- Batch status
CREATE TYPE batch_status AS ENUM ('open', 'closed', 'discrepancy');

-- Case event types
CREATE TYPE case_event_type AS ENUM (
  'created',
  'registered',
  'assigned',
  'reassigned',
  'acknowledged',
  'work_started',
  'completed',
  'submitted_to_reception',
  'received_by_reception',
  'released_to_representative',
  'picked_up_by_representative',
  'delivered',
  'put_on_hold',
  'resumed',
  'rework_requested',
  'cancelled',
  'note_added',
  'info_updated',
  'batch_associated'
);

-- Audit action types
CREATE TYPE audit_action AS ENUM (
  'user_created',
  'user_updated',
  'user_deactivated',
  'user_activated',
  'user_role_changed',
  'user_password_reset',
  'user_invitation_sent',
  'login_success',
  'login_failure',
  'case_reassigned',
  'case_cancelled',
  'case_status_override',
  'settings_changed',
  'system_event'
);

-- =============================================================================
-- TABLE: profiles
-- Links to auth.users, stores application-level user data
-- =============================================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role app_role NOT NULL DEFAULT 'technician',
  status account_status NOT NULL DEFAULT 'pending_invitation',
  phone TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deactivated_at TIMESTAMPTZ,
  
  CONSTRAINT profiles_email_unique UNIQUE (email),
  CONSTRAINT profiles_full_name_length CHECK (char_length(full_name) >= 2 AND char_length(full_name) <= 200),
  CONSTRAINT profiles_email_format CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_status ON profiles(status);
CREATE INDEX idx_profiles_email ON profiles(email);

-- =============================================================================
-- TABLE: dentists
-- External dentist/clinic records (NOT system users)
-- =============================================================================
CREATE TABLE dentists (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  clinic_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES profiles(id),
  
  CONSTRAINT dentists_name_length CHECK (char_length(name) >= 2 AND char_length(name) <= 200)
);

CREATE INDEX idx_dentists_name ON dentists(name);
CREATE INDEX idx_dentists_clinic ON dentists(clinic_name);
CREATE INDEX idx_dentists_active ON dentists(is_active);

-- =============================================================================
-- TABLE: monthly_case_counters
-- Atomic monthly counter for case number generation (CASE-YYYYMM-NNNNN)
-- =============================================================================
CREATE TABLE monthly_case_counters (
  year_month TEXT PRIMARY KEY, -- Format: 'YYYYMM'
  last_number INTEGER NOT NULL DEFAULT 0,
  
  CONSTRAINT valid_year_month CHECK (year_month ~ '^\d{6}$'),
  CONSTRAINT positive_counter CHECK (last_number >= 0)
);

-- =============================================================================
-- TABLE: delivery_batches
-- Physical transfer groups containing multiple cases
-- =============================================================================
CREATE TABLE delivery_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_reference TEXT NOT NULL,
  batch_type batch_type NOT NULL,
  status batch_status NOT NULL DEFAULT 'open',
  representative_id UUID REFERENCES profiles(id),
  receptionist_id UUID REFERENCES profiles(id),
  expected_count INTEGER,
  actual_count INTEGER DEFAULT 0,
  handoff_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  notes TEXT,
  discrepancy_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT batch_reference_unique UNIQUE (batch_reference),
  CONSTRAINT valid_expected_count CHECK (expected_count IS NULL OR expected_count >= 0),
  CONSTRAINT valid_actual_count CHECK (actual_count >= 0)
);

CREATE INDEX idx_batches_type ON delivery_batches(batch_type);
CREATE INDEX idx_batches_status ON delivery_batches(status);
CREATE INDEX idx_batches_representative ON delivery_batches(representative_id);
CREATE INDEX idx_batches_receptionist ON delivery_batches(receptionist_id);
CREATE INDEX idx_batches_handoff_at ON delivery_batches(handoff_at);

-- =============================================================================
-- TABLE: cases
-- Individual dental case records - the core entity
-- =============================================================================
CREATE TABLE cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_number TEXT NOT NULL,
  
  -- Patient information
  patient_name TEXT NOT NULL,
  patient_age INTEGER,
  patient_dob DATE,
  
  -- Dentist/clinic reference
  dentist_id UUID REFERENCES dentists(id),
  dentist_name_text TEXT, -- Fallback if dentist not in system
  clinic_name_text TEXT,
  
  -- Case details
  case_type TEXT NOT NULL,
  tooth_number TEXT,
  shade TEXT,
  description TEXT,
  special_instructions TEXT,
  
  -- Workflow
  current_status case_status NOT NULL DEFAULT 'registered',
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  
  -- Dates
  date_received TIMESTAMPTZ NOT NULL DEFAULT now(),
  due_date DATE,
  completed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  
  -- Assignments
  assigned_technician_id UUID REFERENCES profiles(id),
  assigned_at TIMESTAMPTZ,
  
  -- Batch references
  intake_batch_id UUID REFERENCES delivery_batches(id),
  return_batch_id UUID REFERENCES delivery_batches(id),
  
  -- Registration
  registered_by UUID REFERENCES profiles(id),
  
  -- Metadata
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT cases_case_number_unique UNIQUE (case_number),
  CONSTRAINT cases_patient_name_length CHECK (char_length(patient_name) >= 1 AND char_length(patient_name) <= 300),
  CONSTRAINT cases_case_type_length CHECK (char_length(case_type) >= 1 AND char_length(case_type) <= 200),
  CONSTRAINT cases_valid_age CHECK (patient_age IS NULL OR (patient_age >= 0 AND patient_age <= 150))
);

CREATE INDEX idx_cases_case_number ON cases(case_number);
CREATE INDEX idx_cases_status ON cases(current_status);
CREATE INDEX idx_cases_priority ON cases(priority);
CREATE INDEX idx_cases_assigned_tech ON cases(assigned_technician_id);
CREATE INDEX idx_cases_dentist ON cases(dentist_id);
CREATE INDEX idx_cases_intake_batch ON cases(intake_batch_id);
CREATE INDEX idx_cases_return_batch ON cases(return_batch_id);
CREATE INDEX idx_cases_due_date ON cases(due_date);
CREATE INDEX idx_cases_date_received ON cases(date_received);
CREATE INDEX idx_cases_registered_by ON cases(registered_by);

-- =============================================================================
-- TABLE: batch_cases
-- Many-to-many relationship between batches and cases
-- =============================================================================
CREATE TABLE batch_cases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id UUID NOT NULL REFERENCES delivery_batches(id),
  case_id UUID NOT NULL REFERENCES cases(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  added_by UUID REFERENCES profiles(id),
  
  CONSTRAINT batch_cases_unique UNIQUE (batch_id, case_id)
);

CREATE INDEX idx_batch_cases_batch ON batch_cases(batch_id);
CREATE INDEX idx_batch_cases_case ON batch_cases(case_id);

-- =============================================================================
-- TABLE: case_events
-- IMMUTABLE operational event log for case history
-- NO UPDATE or DELETE allowed for application users
-- =============================================================================
CREATE TABLE case_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id),
  event_type case_event_type NOT NULL,
  
  -- Status transition
  previous_status case_status,
  new_status case_status,
  
  -- Actor and participants
  actor_id UUID NOT NULL REFERENCES profiles(id),
  sender_id UUID REFERENCES profiles(id),
  receiver_id UUID REFERENCES profiles(id),
  
  -- Details
  notes TEXT,
  metadata JSONB DEFAULT '{}',
  
  -- Related entities
  batch_id UUID REFERENCES delivery_batches(id),
  assignment_id UUID REFERENCES profiles(id), -- technician for assignment events
  
  -- Server-generated timestamp only
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- No updated_at — events are immutable
  CONSTRAINT case_events_status_change CHECK (
    (event_type IN ('created', 'note_added', 'info_updated', 'batch_associated'))
    OR (previous_status IS NOT NULL AND new_status IS NOT NULL)
  )
);

CREATE INDEX idx_case_events_case ON case_events(case_id);
CREATE INDEX idx_case_events_type ON case_events(event_type);
CREATE INDEX idx_case_events_actor ON case_events(actor_id);
CREATE INDEX idx_case_events_created ON case_events(created_at);

-- =============================================================================
-- TABLE: technician_assignments
-- Tracks assignment history (not just current assignment)
-- =============================================================================
CREATE TABLE technician_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id UUID NOT NULL REFERENCES cases(id),
  technician_id UUID NOT NULL REFERENCES profiles(id),
  assigned_by UUID NOT NULL REFERENCES profiles(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  unassigned_at TIMESTAMPTZ,
  unassign_reason TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  
  CONSTRAINT one_active_assignment_per_case UNIQUE (case_id, is_active) 
    -- PostgreSQL partial unique index used instead (see below)
);

-- Drop the constraint above and use a partial unique index instead
ALTER TABLE technician_assignments DROP CONSTRAINT one_active_assignment_per_case;

CREATE UNIQUE INDEX idx_one_active_assignment 
  ON technician_assignments(case_id) 
  WHERE is_active = true;

CREATE INDEX idx_assignments_tech ON technician_assignments(technician_id);
CREATE INDEX idx_assignments_case ON technician_assignments(case_id);
CREATE INDEX idx_assignments_active ON technician_assignments(is_active);

-- =============================================================================
-- TABLE: audit_logs
-- Administrative audit trail - separate from case events
-- =============================================================================
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  action audit_action NOT NULL,
  actor_id UUID REFERENCES profiles(id),
  target_id UUID,  -- Could be user ID, case ID, etc.
  target_type TEXT, -- 'user', 'case', 'settings', etc.
  details JSONB DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  
  -- No updated_at — audit logs are immutable
);

CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_target ON audit_logs(target_id);
CREATE INDEX idx_audit_created ON audit_logs(created_at);

-- =============================================================================
-- FUNCTION: generate_case_number()
-- Transaction-safe monthly counter for CASE-YYYYMM-NNNNN format
-- Uses SELECT FOR UPDATE to prevent race conditions
-- =============================================================================
CREATE OR REPLACE FUNCTION generate_case_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year_month TEXT;
  v_next_number INTEGER;
  v_case_number TEXT;
BEGIN
  -- Get current year-month in YYYYMM format (server time)
  v_year_month := to_char(now(), 'YYYYMM');
  
  -- Atomic upsert: insert or increment the counter
  -- The FOR UPDATE lock prevents concurrent transactions from getting the same number
  INSERT INTO monthly_case_counters (year_month, last_number)
  VALUES (v_year_month, 1)
  ON CONFLICT (year_month) DO UPDATE
    SET last_number = monthly_case_counters.last_number + 1
  RETURNING last_number INTO v_next_number;
  
  -- Format: CASE-YYYYMM-NNNNN (zero-padded to 5 digits minimum)
  -- If more than 99999 cases in a month, the number will naturally extend
  -- beyond 5 digits rather than truncating or reusing
  v_case_number := 'CASE-' || v_year_month || '-' || lpad(v_next_number::TEXT, 5, '0');
  
  RETURN v_case_number;
END;
$$;

-- =============================================================================
-- FUNCTION: validate_case_status_transition()
-- Enforces the state machine at the database level
-- Called by trigger before any status change on cases table
-- =============================================================================
CREATE OR REPLACE FUNCTION validate_case_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valid BOOLEAN := false;
  v_actor_role app_role;
  v_actor_status account_status;
BEGIN
  -- If status hasn't changed, allow the update (other fields being modified)
  IF OLD.current_status = NEW.current_status THEN
    RETURN NEW;
  END IF;
  
  -- Get the actor's role and status
  SELECT role, status INTO v_actor_role, v_actor_status
  FROM profiles
  WHERE id = auth.uid();
  
  -- Verify actor is active
  IF v_actor_status != 'active' THEN
    RAISE EXCEPTION 'Account is not active. Cannot modify case status.';
  END IF;
  
  -- Define valid transitions
  v_valid := CASE
    -- Initial registration flow
    WHEN OLD.current_status = 'intake_pending' AND NEW.current_status = 'registered' THEN true
    WHEN OLD.current_status = 'registered' AND NEW.current_status = 'awaiting_assignment' THEN true
    WHEN OLD.current_status = 'intake_pending' AND NEW.current_status = 'awaiting_assignment' THEN true
    
    -- Assignment flow
    WHEN OLD.current_status = 'awaiting_assignment' AND NEW.current_status = 'assigned' THEN true
    WHEN OLD.current_status = 'assigned' AND NEW.current_status = 'in_progress' THEN true
    WHEN OLD.current_status = 'assigned' AND NEW.current_status = 'awaiting_assignment' THEN true -- unassign
    
    -- Production flow
    WHEN OLD.current_status = 'in_progress' AND NEW.current_status = 'completed' THEN true
    WHEN OLD.current_status = 'completed' AND NEW.current_status = 'awaiting_reception_receipt' THEN true
    WHEN OLD.current_status = 'in_progress' AND NEW.current_status = 'awaiting_reception_receipt' THEN true
    
    -- Reception receipt flow
    WHEN OLD.current_status = 'awaiting_reception_receipt' AND NEW.current_status = 'received_by_reception' THEN true
    
    -- Representative pickup flow
    WHEN OLD.current_status = 'received_by_reception' AND NEW.current_status = 'awaiting_representative_pickup' THEN true
    WHEN OLD.current_status = 'awaiting_representative_pickup' AND NEW.current_status = 'with_representative' THEN true
    
    -- Final delivery
    WHEN OLD.current_status = 'with_representative' AND NEW.current_status = 'delivered' THEN true
    
    -- Hold (from active production states)
    WHEN OLD.current_status IN ('assigned', 'in_progress') AND NEW.current_status = 'on_hold' THEN true
    WHEN OLD.current_status = 'on_hold' AND NEW.current_status IN ('assigned', 'in_progress', 'awaiting_assignment') THEN true
    
    -- Rework (from completed/received states)
    WHEN OLD.current_status IN ('completed', 'awaiting_reception_receipt', 'received_by_reception') 
         AND NEW.current_status = 'rework_required' THEN true
    WHEN OLD.current_status = 'rework_required' AND NEW.current_status IN ('assigned', 'awaiting_assignment', 'in_progress') THEN true
    
    -- Cancellation (Owner/Receptionist only, from most states)
    WHEN NEW.current_status = 'cancelled' AND v_actor_role IN ('owner', 'receptionist')
         AND OLD.current_status NOT IN ('delivered', 'cancelled') THEN true
    
    ELSE false
  END;
  
  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid status transition from % to % (actor role: %)', 
      OLD.current_status, NEW.current_status, v_actor_role;
  END IF;
  
  -- Role-based authorization for transitions
  -- Technicians can only: in_progress, completed, on_hold, rework states for their own cases
  IF v_actor_role = 'technician' THEN
    IF NEW.current_status IN ('registered', 'awaiting_assignment', 'assigned', 
                               'received_by_reception', 'awaiting_representative_pickup',
                               'with_representative', 'delivered', 'cancelled') THEN
      RAISE EXCEPTION 'Technicians cannot set status to %', NEW.current_status;
    END IF;
    -- Technician must be the assigned technician
    IF OLD.assigned_technician_id != auth.uid() THEN
      RAISE EXCEPTION 'Technician can only update their own assigned cases';
    END IF;
  END IF;
  
  -- Representatives can only confirm pickup and delivery
  IF v_actor_role = 'representative' THEN
    IF NEW.current_status NOT IN ('with_representative', 'delivered') THEN
      RAISE EXCEPTION 'Representatives can only update pickup and delivery status';
    END IF;
  END IF;
  
  -- Auto-set timestamps
  IF NEW.current_status = 'delivered' AND OLD.current_status != 'delivered' THEN
    NEW.delivered_at := now();
  END IF;
  
  IF NEW.current_status IN ('completed', 'awaiting_reception_receipt') AND OLD.current_status = 'in_progress' THEN
    NEW.completed_at := now();
  END IF;
  
  NEW.updated_at := now();
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_case_status
  BEFORE UPDATE ON cases
  FOR EACH ROW
  EXECUTE FUNCTION validate_case_status_transition();

-- =============================================================================
-- FUNCTION: auto_generate_case_number()
-- Trigger to auto-generate case number on insert
-- =============================================================================
CREATE OR REPLACE FUNCTION auto_generate_case_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only generate if not already provided (should never be provided by client)
  IF NEW.case_number IS NULL OR NEW.case_number = '' THEN
    NEW.case_number := generate_case_number();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_case_number
  BEFORE INSERT ON cases
  FOR EACH ROW
  EXECUTE FUNCTION auto_generate_case_number();

-- =============================================================================
-- FUNCTION: update_timestamp()
-- Auto-update updated_at column
-- =============================================================================
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated
  BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_dentists_updated
  BEFORE UPDATE ON dentists FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER trg_batches_updated
  BEFORE UPDATE ON delivery_batches FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- =============================================================================
-- FUNCTION: get_user_role()
-- Helper to get current user's role efficiently
-- =============================================================================
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS app_role
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_role app_role;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  RETURN v_role;
END;
$$;

-- =============================================================================
-- FUNCTION: is_user_active()
-- Helper to check if current user is active
-- =============================================================================
CREATE OR REPLACE FUNCTION is_user_active()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_status account_status;
BEGIN
  SELECT status INTO v_status FROM profiles WHERE id = auth.uid();
  RETURN v_status = 'active';
END;
$$;

-- =============================================================================
-- ROW LEVEL SECURITY POLICIES
-- =============================================================================

-- ---- PROFILES ----
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- All authenticated active users can read profiles (needed for UI display names)
CREATE POLICY profiles_select ON profiles
  FOR SELECT TO authenticated
  USING (is_user_active());

-- Only owners can insert profiles (via Edge Functions with service_role)
-- Regular users cannot create profiles directly
CREATE POLICY profiles_insert ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (false); -- Profiles created only via Edge Functions

-- Users can update their own limited fields; owners can update any
CREATE POLICY profiles_update ON profiles
  FOR UPDATE TO authenticated
  USING (
    is_user_active() AND (
      id = auth.uid() -- Own profile
      OR get_user_role() = 'owner' -- Owner can edit any
    )
  )
  WITH CHECK (
    is_user_active() AND (
      id = auth.uid()
      OR get_user_role() = 'owner'
    )
  );

-- No one deletes profiles (deactivate instead)
CREATE POLICY profiles_delete ON profiles
  FOR DELETE TO authenticated
  USING (false);

-- ---- DENTISTS ----
ALTER TABLE dentists ENABLE ROW LEVEL SECURITY;

CREATE POLICY dentists_select ON dentists
  FOR SELECT TO authenticated
  USING (is_user_active());

CREATE POLICY dentists_insert ON dentists
  FOR INSERT TO authenticated
  WITH CHECK (
    is_user_active() AND get_user_role() IN ('owner', 'receptionist')
  );

CREATE POLICY dentists_update ON dentists
  FOR UPDATE TO authenticated
  USING (is_user_active() AND get_user_role() IN ('owner', 'receptionist'))
  WITH CHECK (is_user_active() AND get_user_role() IN ('owner', 'receptionist'));

CREATE POLICY dentists_delete ON dentists
  FOR DELETE TO authenticated
  USING (false); -- Soft-delete only via is_active flag

-- ---- DELIVERY BATCHES ----
ALTER TABLE delivery_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY batches_select ON delivery_batches
  FOR SELECT TO authenticated
  USING (is_user_active());

CREATE POLICY batches_insert ON delivery_batches
  FOR INSERT TO authenticated
  WITH CHECK (
    is_user_active() AND get_user_role() IN ('owner', 'receptionist', 'representative')
  );

CREATE POLICY batches_update ON delivery_batches
  FOR UPDATE TO authenticated
  USING (
    is_user_active() AND get_user_role() IN ('owner', 'receptionist', 'representative')
  )
  WITH CHECK (
    is_user_active() AND get_user_role() IN ('owner', 'receptionist', 'representative')
  );

CREATE POLICY batches_delete ON delivery_batches
  FOR DELETE TO authenticated
  USING (false);

-- ---- CASES ----
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;

-- Select: everyone can read, but technicians only see their assigned cases
CREATE POLICY cases_select ON cases
  FOR SELECT TO authenticated
  USING (
    is_user_active() AND (
      get_user_role() IN ('owner', 'receptionist', 'representative')
      OR (get_user_role() = 'technician' AND assigned_technician_id = auth.uid())
    )
  );

-- Insert: owner and receptionist only
CREATE POLICY cases_insert ON cases
  FOR INSERT TO authenticated
  WITH CHECK (
    is_user_active() AND get_user_role() IN ('owner', 'receptionist')
  );

-- Update: role-based (trigger enforces status transition rules)
CREATE POLICY cases_update ON cases
  FOR UPDATE TO authenticated
  USING (
    is_user_active() AND (
      get_user_role() IN ('owner', 'receptionist')
      OR (get_user_role() = 'technician' AND assigned_technician_id = auth.uid())
      OR (get_user_role() = 'representative')
    )
  )
  WITH CHECK (
    is_user_active() AND (
      get_user_role() IN ('owner', 'receptionist')
      OR (get_user_role() = 'technician' AND assigned_technician_id = auth.uid())
      OR (get_user_role() = 'representative')
    )
  );

CREATE POLICY cases_delete ON cases
  FOR DELETE TO authenticated
  USING (false);

-- ---- BATCH CASES ----
ALTER TABLE batch_cases ENABLE ROW LEVEL SECURITY;

CREATE POLICY batch_cases_select ON batch_cases
  FOR SELECT TO authenticated
  USING (is_user_active());

CREATE POLICY batch_cases_insert ON batch_cases
  FOR INSERT TO authenticated
  WITH CHECK (
    is_user_active() AND get_user_role() IN ('owner', 'receptionist', 'representative')
  );

CREATE POLICY batch_cases_delete ON batch_cases
  FOR DELETE TO authenticated
  USING (false);

-- ---- CASE EVENTS (IMMUTABLE) ----
ALTER TABLE case_events ENABLE ROW LEVEL SECURITY;

-- Everyone can read events for cases they can see
CREATE POLICY case_events_select ON case_events
  FOR SELECT TO authenticated
  USING (
    is_user_active() AND (
      get_user_role() IN ('owner', 'receptionist', 'representative')
      OR (get_user_role() = 'technician' AND EXISTS (
        SELECT 1 FROM cases WHERE cases.id = case_events.case_id 
        AND cases.assigned_technician_id = auth.uid()
      ))
    )
  );

-- Authenticated users can insert events for cases they interact with
CREATE POLICY case_events_insert ON case_events
  FOR INSERT TO authenticated
  WITH CHECK (
    is_user_active() AND actor_id = auth.uid()
  );

-- NO UPDATE — events are immutable
CREATE POLICY case_events_update ON case_events
  FOR UPDATE TO authenticated
  USING (false);

-- NO DELETE — events are immutable
CREATE POLICY case_events_delete ON case_events
  FOR DELETE TO authenticated
  USING (false);

-- ---- TECHNICIAN ASSIGNMENTS ----
ALTER TABLE technician_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY assignments_select ON technician_assignments
  FOR SELECT TO authenticated
  USING (
    is_user_active() AND (
      get_user_role() IN ('owner', 'receptionist')
      OR (get_user_role() = 'technician' AND technician_id = auth.uid())
    )
  );

CREATE POLICY assignments_insert ON technician_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    is_user_active() AND get_user_role() IN ('owner', 'receptionist')
  );

CREATE POLICY assignments_update ON technician_assignments
  FOR UPDATE TO authenticated
  USING (
    is_user_active() AND get_user_role() IN ('owner', 'receptionist')
  )
  WITH CHECK (
    is_user_active() AND get_user_role() IN ('owner', 'receptionist')
  );

CREATE POLICY assignments_delete ON technician_assignments
  FOR DELETE TO authenticated
  USING (false);

-- ---- AUDIT LOGS (IMMUTABLE) ----
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Only owners can read audit logs
CREATE POLICY audit_select ON audit_logs
  FOR SELECT TO authenticated
  USING (is_user_active() AND get_user_role() = 'owner');

-- Insert only via Edge Functions (service_role), not direct client
CREATE POLICY audit_insert ON audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (false); -- Inserted via Edge Functions only

-- Immutable
CREATE POLICY audit_update ON audit_logs
  FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY audit_delete ON audit_logs
  FOR DELETE TO authenticated
  USING (false);

-- ---- MONTHLY CASE COUNTERS ----
ALTER TABLE monthly_case_counters ENABLE ROW LEVEL SECURITY;

-- No direct access from client — only via generate_case_number() function
CREATE POLICY counters_select ON monthly_case_counters
  FOR SELECT TO authenticated
  USING (false);

CREATE POLICY counters_insert ON monthly_case_counters
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY counters_update ON monthly_case_counters
  FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY counters_delete ON monthly_case_counters
  FOR DELETE TO authenticated
  USING (false);

-- =============================================================================
-- REVOKE dangerous permissions on immutable tables
-- =============================================================================

-- Revoke UPDATE and DELETE on case_events from all non-superuser roles
REVOKE UPDATE, DELETE ON case_events FROM authenticated;
REVOKE UPDATE, DELETE ON case_events FROM anon;

-- Revoke UPDATE and DELETE on audit_logs
REVOKE UPDATE, DELETE ON audit_logs FROM authenticated;
REVOKE UPDATE, DELETE ON audit_logs FROM anon;

-- =============================================================================
-- FUNCTION: create_profile_for_user()
-- Auto-create a profile when a new auth user is created (via Edge Function)
-- =============================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email, full_name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    COALESCE((NEW.raw_user_meta_data->>'role')::app_role, 'technician'),
    CASE 
      WHEN NEW.email_confirmed_at IS NOT NULL THEN 'active'::account_status
      ELSE 'pending_invitation'::account_status
    END
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- =============================================================================
-- FUNCTION: record_case_event()
-- Helper to safely create case events with validation
-- =============================================================================
CREATE OR REPLACE FUNCTION record_case_event(
  p_case_id UUID,
  p_event_type case_event_type,
  p_previous_status case_status DEFAULT NULL,
  p_new_status case_status DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_sender_id UUID DEFAULT NULL,
  p_receiver_id UUID DEFAULT NULL,
  p_batch_id UUID DEFAULT NULL,
  p_assignment_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  INSERT INTO case_events (
    case_id, event_type, previous_status, new_status,
    actor_id, sender_id, receiver_id, notes,
    batch_id, assignment_id, metadata
  ) VALUES (
    p_case_id, p_event_type, p_previous_status, p_new_status,
    auth.uid(), p_sender_id, p_receiver_id, p_notes,
    p_batch_id, p_assignment_id, p_metadata
  )
  RETURNING id INTO v_event_id;
  
  RETURN v_event_id;
END;
$$;

-- Grant execute on functions
GRANT EXECUTE ON FUNCTION generate_case_number() TO authenticated;
GRANT EXECUTE ON FUNCTION record_case_event(UUID, case_event_type, case_status, case_status, TEXT, UUID, UUID, UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION is_user_active() TO authenticated;
