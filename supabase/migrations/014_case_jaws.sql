-- =============================================================================
-- Migration 014: upper / lower jaw instead of shade and tooth number
-- =============================================================================
-- Dolphin is an orthodontic lab: a case is made for the upper jaw, the lower
-- jaw or both. Shade and tooth number are no longer entered in the app.
--
-- * New nullable columns cases.upper_jaw / cases.lower_jaw. No backfill: old
--   cases keep NULL jaws.
-- * shade and tooth_number are NOT dropped, renamed or changed. Old cases keep
--   their values and the app shows them read-only as old data.
-- * Rule: a case registered from the app (client request, see 003) must have
--   at least one jaw = true. An UPDATE is checked only when it really changes
--   a jaw, so old cases (both NULL) can still be edited and moved through the
--   workflow.
--   A CHECK constraint is not used on purpose: even a NOT VALID constraint is
--   re-checked whenever an old row is updated, which would block editing old
--   cases.
-- * Trusted direct sessions (seed scripts, SQL editor, backup restore: no JWT
--   claims) are not checked, like the other case triggers.
-- * Technicians and representatives still cannot change the jaws:
--   guard_case_columns (003) rejects any non-status column change by them.
--
-- SECURITY DEFINER is needed only to call private.is_client_request(): API
-- roles have no EXECUTE on the private schema's functions (as SECURITY INVOKER
-- the trigger fails with "permission denied for function is_client_request").
-- The function reads only NEW/OLD and the request role; search_path is empty
-- and EXECUTE is revoked from API roles (003 / 006 pattern).
-- Tests: src/test/db/caseJaws.test.ts
-- =============================================================================

ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS upper_jaw boolean,
  ADD COLUMN IF NOT EXISTS lower_jaw boolean;

COMMENT ON COLUMN public.cases.upper_jaw IS
  'Work is for the upper jaw. NULL on cases registered before migration 014.';
COMMENT ON COLUMN public.cases.lower_jaw IS
  'Work is for the lower jaw. NULL on cases registered before migration 014.';
COMMENT ON COLUMN public.cases.shade IS
  'Legacy (before migration 014): no longer entered from the app; kept read-only for old cases.';
COMMENT ON COLUMN public.cases.tooth_number IS
  'Legacy (before migration 014): no longer entered from the app; kept read-only for old cases.';

CREATE OR REPLACE FUNCTION public.validate_case_jaws()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Trusted sessions (seed scripts, SQL editor, restore) keep their values.
  IF NOT private.is_client_request() THEN
    RETURN NEW;
  END IF;

  -- Editing a case without changing its jaws (e.g. an old case with NULL jaws).
  IF TG_OP = 'UPDATE'
     AND NEW.upper_jaw IS NOT DISTINCT FROM OLD.upper_jaw
     AND NEW.lower_jaw IS NOT DISTINCT FROM OLD.lower_jaw THEN
    RETURN NEW;
  END IF;

  IF NOT (coalesce(NEW.upper_jaw, false) OR coalesce(NEW.lower_jaw, false)) THEN
    RAISE EXCEPTION 'At least one jaw (upper or lower) is required'
      USING HINT = 'err.case.jaw_required';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_case_jaws ON public.cases;
CREATE TRIGGER trg_validate_case_jaws
  BEFORE INSERT OR UPDATE OF upper_jaw, lower_jaw ON public.cases
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_case_jaws();

-- Trigger functions are never called directly.
REVOKE EXECUTE ON FUNCTION public.validate_case_jaws() FROM PUBLIC, anon, authenticated;
