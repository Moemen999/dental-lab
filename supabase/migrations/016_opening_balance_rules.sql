-- =============================================================================
-- Migration 016: opening balance rules (follow-up to 015, which is merged)
-- * amount 0 is rejected: "no opening balance" means deleting the row.
-- * as_of cannot be after today's Cairo date (it should be the go-live date).
-- Re-creates the 015 normalize trigger function with the two extra checks.
-- Tests: src/test/db/openingBalanceRules.test.ts
-- =============================================================================

CREATE OR REPLACE FUNCTION public.normalize_opening_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.amount IS NULL OR NEW.as_of IS NULL THEN
    RAISE EXCEPTION 'Opening balance needs an amount and a date' USING HINT = 'err.opening_balance.invalid';
  END IF;
  IF NEW.amount = 0 THEN
    RAISE EXCEPTION 'Opening balance cannot be zero; delete it instead'
      USING HINT = 'err.opening_balance.zero_amount';
  END IF;
  IF NEW.as_of > (now() AT TIME ZONE 'Africa/Cairo')::date THEN
    RAISE EXCEPTION 'Opening balance date cannot be in the future'
      USING HINT = 'err.opening_balance.future_date';
  END IF;
  NEW.note := nullif(btrim(coalesce(NEW.note, '')), '');
  IF NEW.note IS NOT NULL AND char_length(NEW.note) > 2000 THEN
    RAISE EXCEPTION 'Note is too long' USING HINT = 'err.validation.too_long';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.dentist_id := OLD.dentist_id;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.normalize_opening_balance() FROM PUBLIC, anon, authenticated;
