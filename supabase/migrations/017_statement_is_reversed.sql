-- =============================================================================
-- Migration 017: statement lines say whether a payment was already reversed
-- * get_dentist_statement: each line gets is_reversed (true only for a payment
--   that has a reversal, wherever that reversal is dated), so the app needs no
--   extra query before offering "reverse". Same signature, same role rule.
-- Tests: src/test/db/statementReversed.test.ts
-- =============================================================================

-- Statement for [p_from, p_to] (Cairo dates, inclusive). Balance = owed to the lab.
CREATE OR REPLACE FUNCTION public.get_dentist_statement(p_dentist_id uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_dentist public.dentists;
  v_opening numeric;
  v_debit numeric;
  v_credit numeric;
  v_unpriced integer;
  v_lines jsonb;
BEGIN
  IF NOT private.caller_has_role(ARRAY['owner', 'receptionist']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not permitted to view accounts' USING HINT = 'err.money.forbidden';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Invalid statement period' USING HINT = 'err.statement.invalid_period';
  END IF;

  SELECT * INTO v_dentist FROM public.dentists d WHERE d.id = p_dentist_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dentist not found' USING HINT = 'err.dentist.not_found';
  END IF;

  SELECT coalesce(sum(coalesce(l.debit, 0) - coalesce(l.credit, 0)), 0)
    INTO v_opening
    FROM private.dentist_ledger(p_dentist_id) l
   WHERE l.day < p_from;

  SELECT coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0), count(*) FILTER (WHERE NOT l.priced)
    INTO v_debit, v_credit, v_unpriced
    FROM private.dentist_ledger(p_dentist_id) l
   WHERE l.day BETWEEN p_from AND p_to;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'kind', x.kind,
           'at', x.occurred_at,
           'date', x.day,
           'case_id', x.case_id,
           'case_number', x.case_number,
           'patient_name', x.patient_name,
           'work_type', x.work_type,
           'list_price', x.list_price,
           'discount_percent', x.discount_percent,
           'payment_id', x.payment_id,
           'method', x.method,
           'note', x.note,
           'reverses_payment_id', x.reverses_payment_id,
           'debit', x.debit,
           'credit', x.credit,
           'priced', x.priced,
           'is_reversed', (x.kind = 'payment' AND EXISTS (
             SELECT 1 FROM public.payments r WHERE r.reverses_payment_id = x.payment_id)),
           'balance', v_opening + x.running
         ) ORDER BY x.occurred_at, x.kind, coalesce(x.payment_id, x.case_id)), '[]'::jsonb)
    INTO v_lines
    FROM (
      SELECT l.*,
             sum(coalesce(l.debit, 0) - coalesce(l.credit, 0))
               OVER (ORDER BY l.occurred_at, l.kind, coalesce(l.payment_id, l.case_id) ROWS UNBOUNDED PRECEDING) AS running
        FROM private.dentist_ledger(p_dentist_id) l
       WHERE l.day BETWEEN p_from AND p_to
    ) x;

  RETURN jsonb_build_object(
    'dentist', jsonb_build_object(
      'id', v_dentist.id, 'name', v_dentist.name,
      'clinic_name', v_dentist.clinic_name, 'phone', v_dentist.phone
    ),
    'from', p_from,
    'to', p_to,
    'opening_balance', v_opening,
    'total_debit', v_debit,
    'total_credit', v_credit,
    'closing_balance', v_opening + v_debit - v_credit,
    'unpriced_count', v_unpriced,
    'lines', v_lines
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_dentist_statement(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dentist_statement(uuid, date, date) TO authenticated;
