-- =============================================================================
-- Migration 009: Case registration writes its history
-- =============================================================================
-- Fixes docs/KNOWN_ISSUES.md #6 (tests: src/test/db/openIssues.test.ts):
--   Registering a case wrote no 'created' event, and choosing a technician on
--   the registration form wrote no technician_assignments row.
--
-- After this migration, a case INSERT made by a signed-in user writes, in the
-- same transaction:
--   * a 'created' event (new_status = the starting status, assignment_id =
--     the technician when one was chosen),
--   * the active technician_assignments row (reuses sync_technician_assignment
--     from 007).
-- Trusted sessions without a user (seeds/migrations) are not attributed.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.log_case_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.case_events (case_id, event_type, new_status, actor_id, assignment_id)
  VALUES (NEW.id, 'created', NEW.current_status, auth.uid(), NEW.assigned_technician_id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_case_created ON public.cases;
CREATE TRIGGER trg_log_case_created
  AFTER INSERT ON public.cases
  FOR EACH ROW
  EXECUTE FUNCTION public.log_case_created();

DROP TRIGGER IF EXISTS trg_sync_technician_assignment_insert ON public.cases;
CREATE TRIGGER trg_sync_technician_assignment_insert
  AFTER INSERT ON public.cases
  FOR EACH ROW
  WHEN (NEW.assigned_technician_id IS NOT NULL)
  EXECUTE FUNCTION public.sync_technician_assignment();

-- Trigger functions are never called directly.
REVOKE EXECUTE ON FUNCTION public.log_case_created() FROM PUBLIC, anon, authenticated;
