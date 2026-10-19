-- =============================================================================
-- Migration 007: Technician assignment history is written by the database
-- =============================================================================
-- Fixes docs/KNOWN_ISSUES.md #4 (tests: src/test/db/openIssues.test.ts):
--   technician_assignments accepted any assigned_by value from the client, and
--   its row was written in a separate request from the case update (not atomic).
--
-- After this migration:
--   * Changing cases.assigned_technician_id writes the assignment history in the
--     same transaction (trigger trg_sync_technician_assignment):
--       - the previous active assignment is closed,
--       - a new active row is added with assigned_by = auth.uid(),
--       - a 'reassigned' event is logged when the status did not change
--         (status changes are already logged by trg_log_case_status_change).
--   * Clients can no longer INSERT/UPDATE technician_assignments directly.
--   * reassign_and_deactivate_technician relies on the trigger instead of
--     writing the same rows itself. Optional reason text for the trigger is
--     passed in the transaction-local setting app.assignment_reason.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.sync_technician_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_reason text := nullif(current_setting('app.assignment_reason', true), '');
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.assigned_technician_id IS NOT DISTINCT FROM OLD.assigned_technician_id THEN
    RETURN NULL;
  END IF;

  -- Trusted sessions without a user (seeds/migrations) cannot be attributed.
  IF v_actor IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.technician_assignments
     SET is_active = false,
         unassigned_at = now(),
         unassign_reason = coalesce(v_reason, 'Reassigned')
   WHERE case_id = NEW.id AND is_active = true;

  IF NEW.assigned_technician_id IS NOT NULL THEN
    INSERT INTO public.technician_assignments (case_id, technician_id, assigned_by, is_active, notes)
    VALUES (NEW.id, NEW.assigned_technician_id, v_actor, true, v_reason);
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.current_status IS NOT DISTINCT FROM OLD.current_status THEN
    INSERT INTO public.case_events (case_id, event_type, previous_status, new_status, actor_id, notes, assignment_id)
    VALUES (NEW.id, 'reassigned', NEW.current_status, NEW.current_status, v_actor, v_reason,
            NEW.assigned_technician_id);
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_technician_assignment ON public.cases;
CREATE TRIGGER trg_sync_technician_assignment
  AFTER UPDATE OF assigned_technician_id ON public.cases
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_technician_assignment();

-- -----------------------------------------------------------------------------
-- Clients read assignment history; only the database writes it.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS assignments_insert ON public.technician_assignments;
CREATE POLICY assignments_insert ON public.technician_assignments
  FOR INSERT TO authenticated
  WITH CHECK (false); -- written only by database functions

DROP POLICY IF EXISTS assignments_update ON public.technician_assignments;
CREATE POLICY assignments_update ON public.technician_assignments
  FOR UPDATE TO authenticated
  USING (false)
  WITH CHECK (false);

REVOKE INSERT, UPDATE, DELETE ON public.technician_assignments FROM anon, authenticated;

-- -----------------------------------------------------------------------------
-- Deactivation/reassignment: same behavior, history written by the trigger.
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
    IF p_reassign_to_id IS NOT NULL THEN
      PERFORM set_config('app.assignment_reason',
        'Reassigned from deactivated technician. Reason: ' || v_reason, true);

      UPDATE public.cases
         SET assigned_technician_id = p_reassign_to_id, assigned_at = now()
       WHERE id = v_case.id;
    ELSE
      v_next_status := CASE
        WHEN v_case.current_status IN ('assigned', 'in_progress') THEN 'awaiting_assignment'
        ELSE v_case.current_status
      END;

      PERFORM set_config('app.assignment_reason',
        'Unassigned due to technician deactivation. Reason: ' || v_reason, true);
      IF v_next_status IS DISTINCT FROM v_case.current_status THEN
        -- The status trigger writes the event; attach the reason to it.
        PERFORM set_config('app.transition_notes',
          'Unassigned due to technician deactivation. Reason: ' || v_reason, true);
      END IF;

      UPDATE public.cases
         SET assigned_technician_id = NULL, assigned_at = NULL, current_status = v_next_status
       WHERE id = v_case.id;
    END IF;

    v_reassigned_count := v_reassigned_count + 1;
  END LOOP;

  PERFORM set_config('app.assignment_reason', '', true);

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

REVOKE EXECUTE ON FUNCTION public.sync_technician_assignment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reassign_and_deactivate_technician(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reassign_and_deactivate_technician(uuid, uuid, text) TO authenticated;
