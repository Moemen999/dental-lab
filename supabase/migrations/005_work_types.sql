-- =============================================================================
-- Migration 005: Owner-managed work types (أنواع الشغل)
-- =============================================================================
-- Dolphin Orthodontic Lab manages its own list of work types; nothing is seeded.
--
-- * work_types: name (Arabic, stored trimmed, unique ignoring case/spaces),
--   is_active, sort_order. Only an active owner may insert/update. Active staff
--   read active types; the owner also reads inactive ones. No hard delete:
--   types are deactivated so old cases keep their type.
-- * Every create/rename/(de)activation/reorder is written to audit_logs
--   (append-only) by a SECURITY DEFINER trigger.
-- * cases.case_type stays TEXT (a snapshot of the type name). Old cases keep
--   their legacy values untouched. From now on, a browser INSERT, or an UPDATE
--   that changes case_type, must use an ACTIVE work type name.
-- Tests: src/test/db/workTypes.test.ts
-- =============================================================================

CREATE TABLE public.work_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT work_types_name_length CHECK (char_length(btrim(name)) BETWEEN 1 AND 100)
);

-- Unique ignoring case and surrounding spaces (race-safe backstop for the trigger check).
CREATE UNIQUE INDEX work_types_name_unique ON public.work_types (lower(btrim(name)));
CREATE INDEX work_types_active_order ON public.work_types (is_active, sort_order);

-- -----------------------------------------------------------------------------
-- Normalize + validate (clear Arabic-mappable errors instead of raw constraint names)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_work_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.name := btrim(coalesce(NEW.name, ''));

  IF char_length(NEW.name) < 1 OR char_length(NEW.name) > 100 THEN
    RAISE EXCEPTION 'Work type name must be 1-100 characters'
      USING HINT = 'err.work_type.invalid_name';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.work_types w
     WHERE lower(btrim(w.name)) = lower(NEW.name)
       AND w.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'A work type with this name already exists'
      USING HINT = 'err.work_type.duplicate';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.id := OLD.id;
    NEW.created_at := OLD.created_at;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_work_types_normalize
  BEFORE INSERT OR UPDATE ON public.work_types
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_work_type();

-- -----------------------------------------------------------------------------
-- Audit trail (audit_logs is append-only; only definer functions may insert)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_work_type_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_op text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_op := 'created';
  ELSIF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    v_op := CASE WHEN NEW.is_active THEN 'reactivated' ELSE 'deactivated' END;
  ELSIF NEW.name IS DISTINCT FROM OLD.name THEN
    v_op := 'renamed';
  ELSIF NEW.sort_order IS DISTINCT FROM OLD.sort_order THEN
    v_op := 'reordered';
  ELSE
    RETURN NULL; -- nothing changed
  END IF;

  INSERT INTO public.audit_logs (action, actor_id, target_id, target_type, details)
  VALUES (
    'settings_changed',
    auth.uid(),
    NEW.id,
    'work_type',
    jsonb_build_object(
      'op', v_op,
      'name', NEW.name,
      'previous_name', CASE WHEN TG_OP = 'UPDATE' AND NEW.name IS DISTINCT FROM OLD.name THEN OLD.name END,
      'sort_order', NEW.sort_order
    )
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_work_types_audit
  AFTER INSERT OR UPDATE ON public.work_types
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_work_type_change();

-- -----------------------------------------------------------------------------
-- RLS and privileges
-- -----------------------------------------------------------------------------
ALTER TABLE public.work_types ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.work_types FROM anon;
REVOKE DELETE, TRUNCATE ON public.work_types FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.work_types TO authenticated;

CREATE POLICY work_types_select ON public.work_types
  FOR SELECT TO authenticated
  USING (public.is_user_active() AND (is_active OR public.get_user_role() = 'owner'));

CREATE POLICY work_types_insert ON public.work_types
  FOR INSERT TO authenticated
  WITH CHECK (public.is_user_active() AND public.get_user_role() = 'owner');

CREATE POLICY work_types_update ON public.work_types
  FOR UPDATE TO authenticated
  USING (public.is_user_active() AND public.get_user_role() = 'owner')
  WITH CHECK (public.is_user_active() AND public.get_user_role() = 'owner');

CREATE POLICY work_types_delete ON public.work_types
  FOR DELETE TO authenticated
  USING (false); -- deactivate instead

-- -----------------------------------------------------------------------------
-- Cases: new types must come from the active list
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_case_work_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Trusted sessions (seed scripts, SQL editor) and unchanged legacy values are allowed.
  IF NOT private.is_client_request() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.case_type IS NOT DISTINCT FROM OLD.case_type THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.work_types w
     WHERE w.is_active
       AND lower(btrim(w.name)) = lower(btrim(NEW.case_type))
  ) THEN
    RAISE EXCEPTION 'Case type must be an active work type'
      USING HINT = 'err.case.invalid_work_type';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_case_work_type ON public.cases;
CREATE TRIGGER trg_validate_case_work_type
  BEFORE INSERT OR UPDATE OF case_type ON public.cases
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_case_work_type();

-- Trigger functions are never called directly.
REVOKE EXECUTE ON FUNCTION public.normalize_work_type() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_work_type_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_case_work_type() FROM PUBLIC, anon, authenticated;
