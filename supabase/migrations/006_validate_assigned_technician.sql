-- =============================================================================
-- Migration 006: Assigned technician must be an active technician on UPDATE
-- =============================================================================
-- Fixes docs/KNOWN_ISSUES.md #3 (tests: src/test/db/openIssues.test.ts):
--   A receptionist/owner could set cases.assigned_technician_id to any profile
--   (a representative, a receptionist, an inactive technician) with a plain
--   UPDATE. The INSERT path (auto_generate_case_number) already checked it.
-- Clearing the technician (NULL) stays allowed.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.validate_case_technician()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.is_client_request()
     OR NEW.assigned_technician_id IS NULL
     OR NEW.assigned_technician_id IS NOT DISTINCT FROM OLD.assigned_technician_id THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.id = NEW.assigned_technician_id
       AND p.role = 'technician'
       AND p.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Assigned technician must be an active technician'
      USING HINT = 'err.case.invalid_technician';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_case_technician ON public.cases;
CREATE TRIGGER trg_validate_case_technician
  BEFORE UPDATE ON public.cases
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_case_technician();

-- Trigger functions are never called directly.
REVOKE EXECUTE ON FUNCTION public.validate_case_technician() FROM PUBLIC, anon, authenticated;
