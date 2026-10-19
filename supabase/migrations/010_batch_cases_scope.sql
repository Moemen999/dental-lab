-- =============================================================================
-- Migration 010: Adding cases to delivery batches
-- =============================================================================
-- Fixes docs/KNOWN_ISSUES.md #8 (tests: src/test/db/openIssues.test.ts):
--   * representatives could add batch_cases rows to ANY batch;
--   * added_by was taken from the client;
--   * actual_count was recalculated by the client with a read-then-write race
--     (and for representatives the count update was silently rejected by 004).
--
-- After this migration:
--   * representatives add cases only to their own OPEN batches
--     (owner/receptionist unchanged);
--   * added_by is always the caller;
--   * actual_count is increased by the database in the same transaction.
-- =============================================================================

DROP POLICY IF EXISTS batch_cases_insert ON public.batch_cases;
CREATE POLICY batch_cases_insert ON public.batch_cases
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_user_active() AND (
      public.get_user_role() IN ('owner', 'receptionist')
      OR (public.get_user_role() = 'representative' AND EXISTS (
            SELECT 1 FROM public.delivery_batches b
             WHERE b.id = batch_id
               AND b.representative_id = auth.uid()
               AND b.status = 'open'))
    )
  );

CREATE OR REPLACE FUNCTION public.set_batch_case_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF private.is_client_request() THEN
    NEW.added_by := auth.uid();
    NEW.added_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_batch_case_actor ON public.batch_cases;
CREATE TRIGGER trg_batch_case_actor
  BEFORE INSERT ON public.batch_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.set_batch_case_actor();

-- Row-locked increment: concurrent inserts cannot lose a count.
CREATE OR REPLACE FUNCTION public.increment_batch_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.delivery_batches
     SET actual_count = actual_count + 1
   WHERE id = NEW.batch_id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_increment_batch_count ON public.batch_cases;
CREATE TRIGGER trg_increment_batch_count
  AFTER INSERT ON public.batch_cases
  FOR EACH ROW
  EXECUTE FUNCTION public.increment_batch_count();

-- Same as 004, except that actual_count may change when the update comes from
-- a database trigger (pg_trigger_depth() > 1), i.e. trg_increment_batch_count.
CREATE OR REPLACE FUNCTION public.guard_batch_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_rep_editable constant text[] := ARRAY['notes', 'expected_count', 'discrepancy_notes', 'updated_at'];
  c_trigger_editable constant text[] := ARRAY['actual_count', 'updated_at'];
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

  IF pg_trigger_depth() > 1
     AND (to_jsonb(NEW) - c_trigger_editable) IS NOT DISTINCT FROM (to_jsonb(OLD) - c_trigger_editable) THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - c_rep_editable) IS DISTINCT FROM (to_jsonb(OLD) - c_rep_editable) THEN
    RAISE EXCEPTION 'Representatives can only edit notes, expected count and discrepancy notes'
      USING HINT = 'err.batch.rep_limited_edit';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger functions are never called directly.
REVOKE EXECUTE ON FUNCTION public.set_batch_case_actor() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_batch_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_batch_columns() FROM PUBLIC, anon, authenticated;
