-- =============================================================================
-- Migration 008: Deactivating a technician without a replacement
-- =============================================================================
-- Fixes docs/KNOWN_ISSUES.md #5 (tests: src/test/db/openIssues.test.ts):
--   reassign_and_deactivate_technician(p_reassign_to_id => NULL) moves the
--   technician's in_progress cases back to awaiting_assignment, but the state
--   machine did not allow in_progress -> awaiting_assignment, so the whole
--   deactivation failed.
--
-- The state machine now allows in_progress -> awaiting_assignment ONLY when the
-- technician is removed in the same update (assigned_technician_id becomes
-- NULL) and the caller is an active owner. Everything else is unchanged from
-- 003_security_hardening.sql.
-- =============================================================================

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
    -- 008: owner removes the technician from work in progress (deactivation without replacement).
    WHEN OLD.current_status = 'in_progress' AND NEW.current_status = 'awaiting_assignment'
         AND NEW.assigned_technician_id IS NULL
         AND coalesce(v_actor_role = 'owner' AND v_actor_status = 'active', false) THEN true
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

-- Trigger functions are never called directly.
REVOKE EXECUTE ON FUNCTION public.validate_case_status_transition() FROM PUBLIC, anon, authenticated;
