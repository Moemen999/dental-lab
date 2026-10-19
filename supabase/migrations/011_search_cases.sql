-- =============================================================================
-- Migration 011: Case search as a parameterized function
-- =============================================================================
-- Fixes docs/KNOWN_ISSUES.md #11 (tests: src/test/db/openIssues.test.ts):
--   The cases page built a PostgREST .or() filter by pasting the user's search
--   text into the filter string, so characters such as , ( ) . * could change
--   the filter itself.
--
-- search_cases(p_query) receives the text as a value and matches it literally
-- (strpos, no LIKE wildcards) against case_number and patient_name.
-- SECURITY INVOKER: the caller's RLS still decides which cases are visible.
-- The client chains .select()/.eq()/.order()/.range() on it like on the table.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.search_cases(p_query text)
RETURNS SETOF public.cases
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT c.*
    FROM public.cases c
   WHERE strpos(lower(c.case_number), lower(btrim(left(p_query, 100)))) > 0
      OR strpos(lower(c.patient_name), lower(btrim(left(p_query, 100)))) > 0;
$$;

REVOKE EXECUTE ON FUNCTION public.search_cases(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_cases(text) TO authenticated;
