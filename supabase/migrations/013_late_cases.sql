-- =============================================================================
-- 013: late-case alerts (late = due before today, today = due today)
-- "Today" is the lab's local date in Africa/Cairo (handles summer time).
-- Delivered and cancelled cases are never late.
-- Only owner and receptionist may call these functions (enforced here, not in
-- the UI). No new tables; read-only SECURITY DEFINER functions (003 pattern).
-- =============================================================================

CREATE OR REPLACE FUNCTION private.cairo_date(p_at timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT (p_at AT TIME ZONE 'Africa/Cairo')::date;
$$;

REVOKE EXECUTE ON FUNCTION private.cairo_date(timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_late_cases()
RETURNS TABLE (
  id uuid,
  case_number text,
  patient_name text,
  due_date date,
  current_status public.case_status,
  technician_name text,
  dentist_name text,
  dentist_phone text,
  bucket text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := private.cairo_date(now());
BEGIN
  IF NOT private.caller_has_role(ARRAY['owner', 'receptionist']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not permitted to view late cases' USING HINT = 'err.auth.forbidden';
  END IF;

  RETURN QUERY
  SELECT c.id,
         c.case_number,
         c.patient_name,
         c.due_date,
         c.current_status,
         t.full_name,
         coalesce(d.name, c.dentist_name_text),
         d.phone,
         CASE WHEN c.due_date < v_today THEN 'late' ELSE 'today' END
    FROM public.cases c
    LEFT JOIN public.profiles t ON t.id = c.assigned_technician_id
    LEFT JOIN public.dentists d ON d.id = c.dentist_id
   WHERE c.due_date <= v_today
     AND c.current_status NOT IN ('delivered', 'cancelled')
   ORDER BY c.due_date, c.case_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_late_case_counts()
RETURNS TABLE (late_count integer, today_count integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := private.cairo_date(now());
BEGIN
  IF NOT private.caller_has_role(ARRAY['owner', 'receptionist']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not permitted to view late cases' USING HINT = 'err.auth.forbidden';
  END IF;

  RETURN QUERY
  SELECT count(*) FILTER (WHERE c.due_date < v_today)::integer,
         count(*) FILTER (WHERE c.due_date = v_today)::integer
    FROM public.cases c
   WHERE c.due_date <= v_today
     AND c.current_status NOT IN ('delivered', 'cancelled');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_late_cases() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_late_case_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_late_cases() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_late_case_counts() TO authenticated;
