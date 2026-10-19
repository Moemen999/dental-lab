-- =============================================================================
-- Migration 004: Role permission fixes
-- =============================================================================
-- Fixes two issues from docs/KNOWN_ISSUES.md (tests: src/test/db/rolePermissions.test.ts):
--   1. Representatives could UPDATE any delivery batch, including status,
--      confirmed_at, receptionist_id and counts.
--   2. Receptionists could make technician / representative status transitions.
--
-- What each role may do after this migration:
--   Representative + batches: create an OPEN batch for themselves; on their own
--     OPEN batches change only notes, expected_count and discrepancy_notes.
--     Closing/confirming a batch stays with reception and owner.
--   Receptionist + case status: everything except in_progress, completed,
--     awaiting_reception_receipt (technician steps) and with_representative,
--     delivered (representative steps). Owner is unrestricted.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Fix 1a: row-level scope for representatives on delivery_batches
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS batches_insert ON public.delivery_batches;
CREATE POLICY batches_insert ON public.delivery_batches
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_user_active() AND (
      public.get_user_role() IN ('owner', 'receptionist')
      OR (public.get_user_role() = 'representative' AND representative_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS batches_update ON public.delivery_batches;
CREATE POLICY batches_update ON public.delivery_batches
  FOR UPDATE TO authenticated
  USING (
    public.is_user_active() AND (
      public.get_user_role() IN ('owner', 'receptionist')
      OR (public.get_user_role() = 'representative'
          AND representative_id = auth.uid()
          AND status = 'open')
    )
  )
  WITH CHECK (
    public.is_user_active() AND (
      public.get_user_role() IN ('owner', 'receptionist')
      OR (public.get_user_role() = 'representative'
          AND representative_id = auth.uid()
          AND status = 'open')
    )
  );

-- -----------------------------------------------------------------------------
-- Fix 1b: column scope for representatives on delivery_batches
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_batch_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_rep_editable constant text[] := ARRAY['notes', 'expected_count', 'discrepancy_notes', 'updated_at'];
BEGIN
  IF NOT private.is_client_request()
     OR public.get_user_role() IS DISTINCT FROM 'representative' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'open'
       OR NEW.receptionist_id IS NOT NULL
       OR NEW.confirmed_at IS NOT NULL
       OR coalesce(NEW.actual_count, 0) <> 0 THEN
      RAISE EXCEPTION 'Representatives can only create open, unconfirmed batches'
        USING HINT = 'err.batch.rep_create_open_only';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - c_rep_editable) IS DISTINCT FROM (to_jsonb(OLD) - c_rep_editable) THEN
    RAISE EXCEPTION 'Representatives can only edit notes, expected count and discrepancy notes'
      USING HINT = 'err.batch.rep_limited_edit';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_batch_column_guard ON public.delivery_batches;
CREATE TRIGGER trg_batch_column_guard
  BEFORE INSERT OR UPDATE ON public.delivery_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_batch_columns();

-- -----------------------------------------------------------------------------
-- Fix 2: per-role target statuses for receptionists
-- (runs alongside trg_validate_case_status, which still checks the state
--  machine and the technician / representative rules)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_role_transition_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.current_status IS NOT DISTINCT FROM OLD.current_status THEN
    RETURN NEW;
  END IF;

  IF public.get_user_role() = 'receptionist'
     AND NEW.current_status IN ('in_progress', 'completed', 'awaiting_reception_receipt',
                                'with_representative', 'delivered') THEN
    RAISE EXCEPTION 'Receptionists cannot set status to %', NEW.current_status
      USING HINT = 'err.case.role_forbidden_status';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_role_transition_rules ON public.cases;
CREATE TRIGGER trg_enforce_role_transition_rules
  BEFORE UPDATE OF current_status ON public.cases
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_role_transition_rules();

-- Trigger functions are never called directly.
REVOKE EXECUTE ON FUNCTION public.guard_batch_columns() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_role_transition_rules() FROM PUBLIC, anon, authenticated;
