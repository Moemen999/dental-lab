-- =============================================================================
-- Migration 002: Owner Protection, Deactivation Guardrails & Reassignment Logic
-- =============================================================================

-- 1. Function and trigger: Protect the last active Owner from deactivation or demotion
CREATE OR REPLACE FUNCTION protect_last_active_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_active_owner_count INTEGER;
BEGIN
  -- Check if the record being modified or deleted is currently an active owner
  IF OLD.role = 'owner' AND OLD.status = 'active' THEN
    -- If being deleted OR role changed from owner OR status changed from active
    IF TG_OP = 'DELETE' OR NEW.role != 'owner' OR NEW.status != 'active' THEN
      SELECT COUNT(*)
      INTO v_active_owner_count
      FROM profiles
      WHERE role = 'owner' AND status = 'active' AND id != OLD.id;

      IF v_active_owner_count < 1 THEN
        RAISE EXCEPTION 'Operation rejected: Cannot deactivate, demote, or delete the last active Owner account.';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_last_active_owner ON profiles;
CREATE TRIGGER trg_protect_last_active_owner
  BEFORE UPDATE OR DELETE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION protect_last_active_owner();

-- 2. Function: Check employee outstanding responsibilities before deactivation
CREATE OR REPLACE FUNCTION get_employee_outstanding_work(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_active_cases JSONB;
  v_open_batches JSONB;
  v_role app_role;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = p_user_id;

  -- Collect cases currently assigned and not delivered/cancelled
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', c.id,
    'case_number', c.case_number,
    'patient_name', c.patient_name,
    'case_type', c.case_type,
    'current_status', c.current_status,
    'due_date', c.due_date
  )), '[]'::jsonb)
  INTO v_active_cases
  FROM cases c
  WHERE c.assigned_technician_id = p_user_id
    AND c.current_status NOT IN ('delivered', 'cancelled');

  -- Collect batches associated with representative or receptionist that are still open
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', b.id,
    'batch_reference', b.batch_reference,
    'batch_type', b.batch_type,
    'status', b.status,
    'handoff_at', b.handoff_at
  )), '[]'::jsonb)
  INTO v_open_batches
  FROM delivery_batches b
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

-- 3. Stored Procedure / Function: Safely reassign cases and deactivate a technician
CREATE OR REPLACE FUNCTION reassign_and_deactivate_technician(
  p_technician_id UUID,
  p_reassign_to_id UUID,
  p_reason TEXT DEFAULT 'Technician deactivation'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role app_role;
  v_actor_status account_status;
  v_reassigned_count INTEGER := 0;
  v_case RECORD;
BEGIN
  -- Authorization check
  SELECT role, status INTO v_actor_role, v_actor_status
  FROM profiles
  WHERE id = auth.uid();

  IF v_actor_role != 'owner' OR v_actor_status != 'active' THEN
    RAISE EXCEPTION 'Unauthorized: Only active laboratory owners may execute employee deactivation and reassignment.';
  END IF;

  -- Validate target is a technician
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_technician_id AND role = 'technician') THEN
    RAISE EXCEPTION 'Target user is not a technician.';
  END IF;

  -- Validate new technician is active
  IF p_reassign_to_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_reassign_to_id AND role = 'technician' AND status = 'active') THEN
      RAISE EXCEPTION 'New technician must be an active technician.';
    END IF;
  END IF;

  -- Reassign each active case
  FOR v_case IN
    SELECT id, case_number, current_status
    FROM cases
    WHERE assigned_technician_id = p_technician_id
      AND current_status NOT IN ('delivered', 'cancelled')
  LOOP
    IF p_reassign_to_id IS NOT NULL THEN
      -- Reassign to new tech
      UPDATE cases
      SET assigned_technician_id = p_reassign_to_id,
          assigned_at = now(),
          updated_at = now()
      WHERE id = v_case.id;

      -- Mark old assignment inactive
      UPDATE technician_assignments
      SET is_active = false,
          unassigned_at = now(),
          unassign_reason = p_reason
      WHERE case_id = v_case.id AND is_active = true;

      -- Create new assignment
      INSERT INTO technician_assignments (
        case_id, technician_id, assigned_by, is_active, notes
      ) VALUES (
        v_case.id, p_reassign_to_id, auth.uid(), true, 'Reassigned due to: ' || p_reason
      );

      -- Record case event
      PERFORM record_case_event(
        p_case_id => v_case.id,
        p_event_type => 'reassigned'::case_event_type,
        p_notes => 'Reassigned from deactivated technician to new technician. Reason: ' || p_reason,
        p_assignment_id => p_reassign_to_id
      );
    ELSE
      -- Unassign and set status to awaiting_assignment if in assigned state
      UPDATE cases
      SET assigned_technician_id = NULL,
          assigned_at = NULL,
          current_status = CASE 
            WHEN current_status IN ('assigned', 'in_progress') THEN 'awaiting_assignment'::case_status
            ELSE current_status
          END,
          updated_at = now()
      WHERE id = v_case.id;

      -- Mark assignment inactive
      UPDATE technician_assignments
      SET is_active = false,
          unassigned_at = now(),
          unassign_reason = p_reason
      WHERE case_id = v_case.id AND is_active = true;

      -- Record event
      PERFORM record_case_event(
        p_case_id => v_case.id,
        p_event_type => 'reassigned'::case_event_type,
        p_notes => 'Unassigned due to technician deactivation. Returned to queue. Reason: ' || p_reason
      );
    END IF;

    v_reassigned_count := v_reassigned_count + 1;
  END LOOP;

  -- Deactivate the target profile
  UPDATE profiles
  SET status = 'inactive',
      deactivated_at = now(),
      updated_at = now()
  WHERE id = p_technician_id;

  -- Insert administrative audit log
  INSERT INTO audit_logs (
    action, actor_id, target_id, target_type, details
  ) VALUES (
    'user_deactivated'::audit_action,
    auth.uid(),
    p_technician_id,
    'user',
    jsonb_build_object(
      'reason', p_reason,
      'reassigned_case_count', v_reassigned_count,
      'reassigned_to', p_reassign_to_id
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'deactivated_user_id', p_technician_id,
    'reassigned_count', v_reassigned_count
  );
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_employee_outstanding_work(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reassign_and_deactivate_technician(UUID, UUID, TEXT) TO authenticated;
