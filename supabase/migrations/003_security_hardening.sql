-- =============================================================================
-- Migration 003: Security hardening
-- =============================================================================
-- Fixes privilege problems found in 001/002 (verified by src/test/db/security.test.ts):
--   1. Any user could change their own role/status on profiles.
--   2. get_employee_outstanding_work had no permission check (anon could read patient data).
--   3. reassign_and_deactivate_technician's check evaluated to NULL for anon (auth bypass).
--   4. generate_case_number was executable by anon/authenticated.
--   5. Non-status columns on cases were writable by representatives and technicians.
--   6. INSERT accepted client-chosen case_number, current_status and registered_by.
--   7. case history could be forged via record_case_event or direct INSERT.
--   8. handle_new_user trusted raw_user_meta_data.role (signup as owner).
-- Also: every SECURITY DEFINER function is re-created with search_path = '' and
-- fully-qualified names, with NULL-safe permission checks, and EXECUTE is revoked
-- from PUBLIC/anon.
--
-- Request context: PostgREST sets request.jwt.claims for every API request
-- (role anon / authenticated / service_role). Requests WITHOUT claims are direct
-- database sessions (migrations, SQL editor, seed scripts) and are trusted.
--
-- Errors carry a stable machine-readable key in HINT (e.g. 'err.case.immutable_column')
-- so the UI can map them to translated messages.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Private helper schema (not exposed through the Data API)
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.request_role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
$$;

-- TRUE for requests coming from the browser (anon or signed-in users).
CREATE OR REPLACE FUNCTION private.is_client_request()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(private.request_role() IN ('anon', 'authenticated'), false);
$$;

-- NULL-safe: returns FALSE (never NULL) when there is no caller or no profile.
CREATE OR REPLACE FUNCTION private.caller_has_role(p_roles public.app_role[])
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT p.status = 'active' AND p.role = ANY (p_roles)
       FROM public.profiles p
      WHERE p.id = auth.uid()),
    false
  );
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;

-- -----------------------------------------------------------------------------
-- RLS helpers (still SECURITY DEFINER to avoid recursion on profiles)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.role FROM public.profiles p WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_user_active()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT p.status = 'active' FROM public.profiles p WHERE p.id = auth.uid()),
    false
  );
$$;

-- -----------------------------------------------------------------------------
-- Fix 4: case number generator is internal only
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_case_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_year_month text := to_char(now(), 'YYYYMM');
  v_next_number integer;
BEGIN
  INSERT INTO public.monthly_case_counters (year_month, last_number)
  VALUES (v_year_month, 1)
  ON CONFLICT (year_month) DO UPDATE
    SET last_number = public.monthly_case_counters.last_number + 1
  RETURNING last_number INTO v_next_number;

  RETURN 'CASE-' || v_year_month || '-' || lpad(v_next_number::text, 5, '0');
END;
$$;

-- -----------------------------------------------------------------------------
-- Fix 6: INSERT derives server-owned columns, ignoring client values
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_generate_case_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_client_request() THEN
    -- Trusted session (seed scripts, SQL editor): keep explicit values.
    IF NEW.case_number IS NULL OR NEW.case_number = '' THEN
      NEW.case_number := public.generate_case_number();
    END IF;
    RETURN NEW;
  END IF;

  NEW.case_number   := public.generate_case_number();
  NEW.registered_by := auth.uid();
  NEW.created_at    := now();
  NEW.updated_at    := now();
  NEW.completed_at  := NULL;
  NEW.delivered_at  := NULL;

  IF NEW.assigned_technician_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = NEW.assigned_technician_id
         AND p.role = 'technician'
         AND p.status = 'active'
    ) THEN
      RAISE EXCEPTION 'Assigned technician must be an active technician'
        USING HINT = 'err.case.invalid_technician';
    END IF;
    NEW.current_status := 'assigned';
    NEW.assigned_at    := now();
  ELSE
    NEW.current_status := 'awaiting_assignment';
    NEW.assigned_at    := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Fix 5: column-level guard on cases (fires before trg_validate_case_status)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_case_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.app_role;
  -- Columns a technician / representative is allowed to touch (status only;
  -- the timestamps below are server-managed and reset here).
  c_status_only constant text[] := ARRAY['current_status', 'updated_at', 'completed_at', 'delivered_at'];
BEGIN
  IF NOT private.is_client_request() THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.case_number IS DISTINCT FROM OLD.case_number
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.registered_by IS DISTINCT FROM OLD.registered_by THEN
    RAISE EXCEPTION 'Case number, id, creation time and registrar cannot be changed'
      USING HINT = 'err.case.immutable_column';
  END IF;

  -- Server-managed timestamps: trg_validate_case_status sets them on transitions.
  NEW.completed_at := OLD.completed_at;
  NEW.delivered_at := OLD.delivered_at;
  NEW.updated_at   := now();

  v_role := public.get_user_role();

  IF v_role IS NULL OR v_role IN ('technician', 'representative') THEN
    IF (to_jsonb(NEW) - c_status_only) IS DISTINCT FROM (to_jsonb(OLD) - c_status_only) THEN
      RAISE EXCEPTION 'Your role may only change the case status'
        USING HINT = 'err.case.status_only';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_case_column_guard ON public.cases;
CREATE TRIGGER trg_case_column_guard
  BEFORE UPDATE ON public.cases
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_case_columns();

-- -----------------------------------------------------------------------------
-- State machine trigger: NULL-safe actor checks
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_case_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_valid boolean;
  v_actor_role public.app_role;
  v_actor_status public.account_status;
  v_enforce boolean;
BEGIN
  IF NEW.current_status IS NOT DISTINCT FROM OLD.current_status THEN
    RETURN NEW;
  END IF;

  SELECT p.role, p.status INTO v_actor_role, v_actor_status
    FROM public.profiles p
   WHERE p.id = auth.uid();

  -- Browser requests and any request with a user identity are checked.
  v_enforce := private.is_client_request() OR auth.uid() IS NOT NULL;

  IF v_enforce AND v_actor_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'Account is not active. Cannot modify case status.'
      USING HINT = 'err.auth.inactive';
  END IF;

  v_valid := CASE
    WHEN OLD.current_status = 'intake_pending' AND NEW.current_status IN ('registered', 'awaiting_assignment') THEN true
    WHEN OLD.current_status = 'registered' AND NEW.current_status = 'awaiting_assignment' THEN true
    WHEN OLD.current_status = 'awaiting_assignment' AND NEW.current_status = 'assigned' THEN true
    WHEN OLD.current_status = 'assigned' AND NEW.current_status IN ('in_progress', 'awaiting_assignment') THEN true
    WHEN OLD.current_status = 'in_progress' AND NEW.current_status IN ('completed', 'awaiting_reception_receipt') THEN true
    WHEN OLD.current_status = 'completed' AND NEW.current_status = 'awaiting_reception_receipt' THEN true
    WHEN OLD.current_status = 'awaiting_reception_receipt' AND NEW.current_status = 'received_by_reception' THEN true
    WHEN OLD.current_status = 'received_by_reception' AND NEW.current_status = 'awaiting_representative_pickup' THEN true
    WHEN OLD.current_status = 'awaiting_representative_pickup' AND NEW.current_status = 'with_representative' THEN true
    WHEN OLD.current_status = 'with_representative' AND NEW.current_status = 'delivered' THEN true
    WHEN OLD.current_status IN ('assigned', 'in_progress') AND NEW.current_status = 'on_hold' THEN true
    WHEN OLD.current_status = 'on_hold' AND NEW.current_status IN ('assigned', 'in_progress', 'awaiting_assignment') THEN true
    WHEN OLD.current_status IN ('completed', 'awaiting_reception_receipt', 'received_by_reception')
         AND NEW.current_status = 'rework_required' THEN true
    WHEN OLD.current_status = 'rework_required' AND NEW.current_status IN ('assigned', 'awaiting_assignment', 'in_progress') THEN true
    WHEN NEW.current_status = 'cancelled'
         AND coalesce(v_actor_role IN ('owner', 'receptionist'), false)
         AND OLD.current_status NOT IN ('delivered', 'cancelled') THEN true
    ELSE false
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid status transition from % to %', OLD.current_status, NEW.current_status
      USING HINT = 'err.case.invalid_transition';
  END IF;

  IF v_enforce AND v_actor_role = 'technician' THEN
    IF NEW.current_status IN ('registered', 'awaiting_assignment', 'assigned',
                              'received_by_reception', 'awaiting_representative_pickup',
                              'with_representative', 'delivered', 'cancelled') THEN
      RAISE EXCEPTION 'Technicians cannot set status to %', NEW.current_status
        USING HINT = 'err.case.role_forbidden_status';
    END IF;
    IF OLD.assigned_technician_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Technician can only update their own assigned cases'
        USING HINT = 'err.case.not_assigned_to_you';
    END IF;
  END IF;

  IF v_enforce AND v_actor_role = 'representative'
     AND NEW.current_status NOT IN ('with_representative', 'delivered') THEN
    RAISE EXCEPTION 'Representatives can only update pickup and delivery status'
      USING HINT = 'err.case.role_forbidden_status';
  END IF;

  IF NEW.current_status = 'delivered' THEN
    NEW.delivered_at := now();
  END IF;
  IF NEW.current_status IN ('completed', 'awaiting_reception_receipt') AND OLD.current_status = 'in_progress' THEN
    NEW.completed_at := now();
  END IF;
  NEW.updated_at := now();

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Fix 7: authoritative case history
--   * status events are written by the database, never by the client
--   * clients may only add notes (record_case_event) on cases they can see
--   * direct INSERT into case_events is revoked
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.case_event_type_for(p_from public.case_status, p_to public.case_status)
RETURNS public.case_event_type
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT (CASE
    WHEN p_to = 'cancelled' THEN 'cancelled'
    WHEN p_to = 'on_hold' THEN 'put_on_hold'
    WHEN p_to = 'rework_required' THEN 'rework_requested'
    WHEN p_from = 'on_hold' THEN 'resumed'
    WHEN p_to IN ('registered') THEN 'registered'
    WHEN p_from IN ('intake_pending', 'registered') AND p_to = 'awaiting_assignment' THEN 'registered'
    WHEN p_from = 'awaiting_assignment' AND p_to = 'assigned' THEN 'assigned'
    WHEN p_to IN ('assigned', 'awaiting_assignment') THEN 'reassigned'
    WHEN p_to = 'in_progress' THEN 'work_started'
    WHEN p_to = 'completed' THEN 'completed'
    WHEN p_to = 'awaiting_reception_receipt' THEN 'submitted_to_reception'
    WHEN p_to = 'received_by_reception' THEN 'received_by_reception'
    WHEN p_to = 'awaiting_representative_pickup' THEN 'released_to_representative'
    WHEN p_to = 'with_representative' THEN 'picked_up_by_representative'
    WHEN p_to = 'delivered' THEN 'delivered'
    ELSE 'info_updated'
  END)::public.case_event_type;
$$;

CREATE OR REPLACE FUNCTION public.log_case_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_notes text := nullif(current_setting('app.transition_notes', true), '');
BEGIN
  -- Consume the notes so they don't leak into a later update in the same transaction.
  PERFORM set_config('app.transition_notes', '', true);

  -- Trusted sessions without a user (seeds/migrations) cannot be attributed.
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.case_events (
    case_id, event_type, previous_status, new_status, actor_id, notes, assignment_id
  ) VALUES (
    NEW.id,
    public.case_event_type_for(OLD.current_status, NEW.current_status),
    OLD.current_status,
    NEW.current_status,
    auth.uid(),
    v_notes,
    CASE WHEN NEW.current_status = 'assigned' THEN NEW.assigned_technician_id END
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_case_status_change ON public.cases;
CREATE TRIGGER trg_log_case_status_change
  AFTER UPDATE OF current_status ON public.cases
  FOR EACH ROW
  WHEN (OLD.current_status IS DISTINCT FROM NEW.current_status)
  EXECUTE FUNCTION public.log_case_status_change();

-- Client entry point for status changes: runs as the caller (RLS + triggers apply)
-- and attaches the optional notes to the automatically written event.
CREATE OR REPLACE FUNCTION public.transition_case_status(
  p_case_id uuid,
  p_new_status public.case_status,
  p_notes text DEFAULT NULL
)
RETURNS public.cases
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_case public.cases;
BEGIN
  IF p_notes IS NOT NULL AND char_length(p_notes) > 2000 THEN
    RAISE EXCEPTION 'Notes are too long' USING HINT = 'err.validation.too_long';
  END IF;

  PERFORM set_config('app.transition_notes', coalesce(p_notes, ''), true);

  UPDATE public.cases
     SET current_status = p_new_status
   WHERE id = p_case_id
  RETURNING * INTO v_case;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Case not found or not permitted' USING HINT = 'err.case.not_found';
  END IF;

  RETURN v_case;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_case_event(
  p_case_id uuid,
  p_event_type public.case_event_type,
  p_previous_status public.case_status DEFAULT NULL,
  p_new_status public.case_status DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_sender_id uuid DEFAULT NULL,
  p_receiver_id uuid DEFAULT NULL,
  p_batch_id uuid DEFAULT NULL,
  p_assignment_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role public.app_role;
  v_event_id uuid;
BEGIN
  IF NOT private.caller_has_role(ARRAY['owner', 'receptionist', 'technician']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not permitted to add case notes' USING HINT = 'err.auth.forbidden';
  END IF;

  IF p_event_type <> 'note_added' OR p_previous_status IS NOT NULL OR p_new_status IS NOT NULL THEN
    RAISE EXCEPTION 'Only notes can be recorded manually; status history is automatic'
      USING HINT = 'err.event.notes_only';
  END IF;

  IF p_notes IS NULL OR btrim(p_notes) = '' OR char_length(p_notes) > 2000 THEN
    RAISE EXCEPTION 'Note text is required (max 2000 characters)' USING HINT = 'err.validation.note';
  END IF;

  v_role := public.get_user_role();
  IF NOT EXISTS (
    SELECT 1 FROM public.cases c
     WHERE c.id = p_case_id
       AND (v_role IN ('owner', 'receptionist') OR c.assigned_technician_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'Case not found or not permitted' USING HINT = 'err.case.not_found';
  END IF;

  INSERT INTO public.case_events (case_id, event_type, actor_id, notes, metadata)
  VALUES (p_case_id, 'note_added', auth.uid(), p_notes, '{}'::jsonb)
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

DROP POLICY IF EXISTS case_events_insert ON public.case_events;
CREATE POLICY case_events_insert ON public.case_events
  FOR INSERT TO authenticated
  WITH CHECK (false); -- written only by database functions
REVOKE INSERT ON public.case_events FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- Fix 1: profile column guard
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_profile_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_self_editable constant text[] := ARRAY['full_name', 'phone', 'avatar_url', 'updated_at'];
  c_owner_locked  constant text[] := ARRAY['id', 'email', 'created_at'];
  k text;
BEGIN
  IF NOT private.is_client_request() THEN
    RETURN NEW;
  END IF;

  IF private.caller_has_role(ARRAY['owner']::public.app_role[]) THEN
    FOREACH k IN ARRAY c_owner_locked LOOP
      IF (to_jsonb(NEW) -> k) IS DISTINCT FROM (to_jsonb(OLD) -> k) THEN
        RAISE EXCEPTION 'Column % cannot be changed from the app', k
          USING HINT = 'err.profile.immutable_column';
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - c_self_editable) IS DISTINCT FROM (to_jsonb(OLD) - c_self_editable) THEN
    RAISE EXCEPTION 'You can only edit your name, phone and avatar'
      USING HINT = 'err.profile.self_edit_only';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_column_guard ON public.profiles;
CREATE TRIGGER trg_profiles_column_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_columns();

CREATE OR REPLACE FUNCTION public.protect_last_active_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.role = 'owner' AND OLD.status = 'active'
     AND (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.status <> 'active')
     AND NOT EXISTS (
       SELECT 1 FROM public.profiles p
        WHERE p.role = 'owner' AND p.status = 'active' AND p.id <> OLD.id
     ) THEN
    RAISE EXCEPTION 'Operation rejected: Cannot deactivate, demote, or delete the last active Owner account.'
      USING HINT = 'err.profile.last_owner';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Fix 8: signup never grants a role or activates the account
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name text := btrim(coalesce(NEW.raw_user_meta_data ->> 'full_name', ''));
BEGIN
  IF char_length(v_name) < 2 OR char_length(v_name) > 200 THEN
    v_name := NEW.email;
  END IF;

  -- Role and status are set afterwards by the Owner (manage-users Edge Function
  -- or SQL editor). user_metadata is user-editable and is never trusted here.
  INSERT INTO public.profiles (id, email, full_name, role, status)
  VALUES (NEW.id, NEW.email, v_name, 'technician', 'pending_invitation');
  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- Fix 2: owner-only outstanding work lookup
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_employee_outstanding_work(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_active_cases jsonb;
  v_open_batches jsonb;
  v_role public.app_role;
BEGIN
  IF NOT private.caller_has_role(ARRAY['owner']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only active owners may inspect employee workload'
      USING HINT = 'err.auth.owner_only';
  END IF;

  SELECT p.role INTO v_role FROM public.profiles p WHERE p.id = p_user_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'case_number', c.case_number,
    'patient_name', c.patient_name,
    'case_type', c.case_type,
    'current_status', c.current_status,
    'due_date', c.due_date
  )), '[]'::jsonb)
  INTO v_active_cases
  FROM public.cases c
  WHERE c.assigned_technician_id = p_user_id
    AND c.current_status NOT IN ('delivered', 'cancelled');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'batch_reference', b.batch_reference,
    'batch_type', b.batch_type,
    'status', b.status,
    'handoff_at', b.handoff_at
  )), '[]'::jsonb)
  INTO v_open_batches
  FROM public.delivery_batches b
  WHERE (b.representative_id = p_user_id OR b.receptionist_id = p_user_id)
    AND b.status = 'open';

  RETURN jsonb_build_object(
    'user_id', p_user_id,
    'role', v_role,
    'active_case_count', jsonb_array_length(v_active_cases),
    'active_cases', v_active_cases,
    'open_batch_count', jsonb_array_length(v_open_batches),
    'open_batches', v_open_batches
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Fix 3: owner-only reassignment with NULL-safe check and a real actor
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reassign_and_deactivate_technician(
  p_technician_id uuid,
  p_reassign_to_id uuid,
  p_reason text DEFAULT 'Technician deactivation'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := coalesce(nullif(btrim(p_reason), ''), 'Technician deactivation');
  v_reassigned_count integer := 0;
  v_case record;
  v_next_status public.case_status;
BEGIN
  IF v_actor IS NULL OR NOT private.caller_has_role(ARRAY['owner']::public.app_role[]) THEN
    RAISE EXCEPTION 'Unauthorized: Only active laboratory owners may execute employee deactivation and reassignment.'
      USING HINT = 'err.auth.owner_only';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_technician_id AND role = 'technician') THEN
    RAISE EXCEPTION 'Target user is not a technician.' USING HINT = 'err.profile.not_technician';
  END IF;

  IF p_reassign_to_id IS NOT NULL THEN
    IF p_reassign_to_id = p_technician_id OR NOT EXISTS (
      SELECT 1 FROM public.profiles
       WHERE id = p_reassign_to_id AND role = 'technician' AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'New technician must be a different active technician.'
        USING HINT = 'err.profile.invalid_replacement';
    END IF;
  END IF;

  FOR v_case IN
    SELECT id, current_status
      FROM public.cases
     WHERE assigned_technician_id = p_technician_id
       AND current_status NOT IN ('delivered', 'cancelled')
     FOR UPDATE
  LOOP
    UPDATE public.technician_assignments
       SET is_active = false, unassigned_at = now(), unassign_reason = v_reason
     WHERE case_id = v_case.id AND is_active = true;

    IF p_reassign_to_id IS NOT NULL THEN
      UPDATE public.cases
         SET assigned_technician_id = p_reassign_to_id, assigned_at = now()
       WHERE id = v_case.id;

      INSERT INTO public.technician_assignments (case_id, technician_id, assigned_by, is_active, notes)
      VALUES (v_case.id, p_reassign_to_id, v_actor, true, 'Reassigned due to: ' || v_reason);

      INSERT INTO public.case_events (case_id, event_type, previous_status, new_status, actor_id, notes, assignment_id)
      VALUES (v_case.id, 'reassigned', v_case.current_status, v_case.current_status, v_actor,
              'Reassigned from deactivated technician. Reason: ' || v_reason, p_reassign_to_id);
    ELSE
      v_next_status := CASE
        WHEN v_case.current_status IN ('assigned', 'in_progress') THEN 'awaiting_assignment'
        ELSE v_case.current_status
      END;

      IF v_next_status IS DISTINCT FROM v_case.current_status THEN
        -- The status trigger writes the event; attach the reason to it.
        PERFORM set_config('app.transition_notes',
          'Unassigned due to technician deactivation. Reason: ' || v_reason, true);
      END IF;

      UPDATE public.cases
         SET assigned_technician_id = NULL, assigned_at = NULL, current_status = v_next_status
       WHERE id = v_case.id;

      IF v_next_status IS NOT DISTINCT FROM v_case.current_status THEN
        INSERT INTO public.case_events (case_id, event_type, previous_status, new_status, actor_id, notes)
        VALUES (v_case.id, 'reassigned', v_case.current_status, v_case.current_status, v_actor,
                'Unassigned due to technician deactivation. Reason: ' || v_reason);
      END IF;
    END IF;

    v_reassigned_count := v_reassigned_count + 1;
  END LOOP;

  UPDATE public.profiles
     SET status = 'inactive', deactivated_at = now()
   WHERE id = p_technician_id;

  INSERT INTO public.audit_logs (action, actor_id, target_id, target_type, details)
  VALUES ('user_deactivated', v_actor, p_technician_id, 'user',
          jsonb_build_object('reason', v_reason,
                             'reassigned_case_count', v_reassigned_count,
                             'reassigned_to', p_reassign_to_id));

  RETURN jsonb_build_object(
    'success', true,
    'deactivated_user_id', p_technician_id,
    'reassigned_count', v_reassigned_count
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- EXECUTE privileges: nothing is callable by anon; only what the app needs is
-- callable by authenticated users.
-- -----------------------------------------------------------------------------
-- Only functions owned by this app (extension functions such as uuid_generate_v4 are left alone).
DO $$
DECLARE
  f regprocedure;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_user_active() TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_case_status(uuid, public.case_status, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_case_event(uuid, public.case_event_type, public.case_status, public.case_status, text, uuid, uuid, uuid, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_employee_outstanding_work(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_and_deactivate_technician(uuid, uuid, text) TO authenticated;

-- Future functions in public are not executable by anon unless granted explicitly.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon;
