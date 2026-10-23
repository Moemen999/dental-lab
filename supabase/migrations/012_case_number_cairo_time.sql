-- =============================================================================
-- 012: case numbers use the lab's local month (KNOWN_ISSUES #9)
-- generate_case_number used now() in the server time zone (UTC), so cases
-- registered in Egypt shortly after midnight on the 1st got the previous
-- month's prefix. The month is now taken in Africa/Cairo (handles summer time).
-- Only the function changes: existing case numbers and counters are untouched.
-- =============================================================================

CREATE OR REPLACE FUNCTION private.case_number_month(p_at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT to_char(p_at AT TIME ZONE 'Africa/Cairo', 'YYYYMM');
$$;

REVOKE EXECUTE ON FUNCTION private.case_number_month(timestamptz) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.generate_case_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_year_month text := private.case_number_month(now());
  v_next_number integer;
BEGIN
  INSERT INTO public.monthly_case_counters (year_month, last_number)
  VALUES (v_year_month, 1)
  ON CONFLICT (year_month) DO UPDATE
    SET last_number = public.monthly_case_counters.last_number + 1
  RETURNING last_number INTO v_next_number;

  RETURN 'CASE-' || v_year_month || '-' || lpad(v_next_number::text, 5, '0');
END;
$$;

-- Internal only (same as 003).
REVOKE EXECUTE ON FUNCTION public.generate_case_number() FROM PUBLIC, anon, authenticated;
