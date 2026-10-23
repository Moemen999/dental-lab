-- =============================================================================
-- Migration 015: Pricing, doctor discounts, payments and doctor statements
-- (الأسعار والحسابات). Currency EGP; every amount is numeric(12,2), never float.
-- =============================================================================
-- Money is visible ONLY to active owners and receptionists. Technicians and
-- representatives can read cases, dentists and work_types, so no money column
-- is added to those tables; everything lives in four new tables with RLS:
--
-- * price_list        one price per work type. Owner writes; owner+reception read.
-- * dentist_discounts one discount % per doctor. Owner writes; owner+reception read.
-- * case_charges      one row per case, created by trigger when the case is
--                     inserted: snapshot of the list price of its work type and
--                     the doctor's discount at that moment. net_amount is a
--                     stored generated column. Only the owner may change a
--                     case's price/discount (price_source becomes 'manual').
-- * payments          append-only: UPDATE/DELETE/TRUNCATE are revoked from the
--                     API roles AND blocked by triggers for every role (also
--                     the database owner). A correction is a new row with the
--                     negative amount that references the original
--                     (reverses_payment_id), at most one reversal per payment.
-- * dentist_opening_balances  OPTIONAL balance per doctor for the time before
--                     this module (owner writes/deletes; owner+reception read).
--                     Counts as a statement line on its date as_of.
-- The service role gets no write access to any of the money tables (the app
-- never uses it for money).
--
-- Matching cases.case_type (TEXT snapshot of the work type NAME, see 005) to a
-- work type: lower(btrim(name)) equality, active or inactive types (names are
-- unique on that expression). Legacy values (e.g. 'Crown') match nothing and
-- stay unpriced until the owner prices the case by hand.
--
-- When the owner sets a price for a work type, cases of that type whose charge
-- is still unpriced (list source, not cancelled; delivered ones included, on
-- purpose) take that price and the doctor's CURRENT discount: an unpriced
-- charge has no snapshot yet. Already priced charges never change when the
-- price list or a discount changes.
--
-- When is a charge due? Only when the case is DELIVERED and has a doctor. The
-- delivery time is cases.delivered_at, which is server-managed:
-- trg_validate_case_status sets it to now() on the transition to 'delivered'
-- (003/008), guard_case_columns stops clients from writing it, and a case
-- inserted directly as 'delivered' (trusted SQL) gets now() here. Only rows
-- from before this migration can still lack it; they fall back to created_at
-- (never updated_at, which moves on every edit). 'delivered' is terminal and
-- cancelled cases never count. Dates are taken in Africa/Cairo.
-- Cases with no dentist_id (free-text doctor only) are in no doctor's balance.
--
-- The doctor of a DELIVERED case can be changed only by the owner (or a
-- trusted SQL session); it is audited, and a 'list' charge takes the new
-- doctor's current discount ('manual' charges keep theirs). The doctor of any
-- case with payments cannot be changed.
--
-- Existing cases: open cases (not delivered, not cancelled) get an unpriced
-- charge row here; delivered/cancelled cases from before this migration get no
-- charge (old deliveries were settled outside the system).
--
-- Audit (append-only audit_logs, existing enum values only):
--   settings_changed / 'price'            price list changes (+ the cases priced)
--   settings_changed / 'dentist_discount' discount changes
--   settings_changed / 'case_price'       direct edits of a case's price, re-pricing
--                                         after a work type/doctor change, and
--                                         doctor changes of delivered cases
--   system_event     / 'payment'          payments and reversals
-- Tests: src/test/db/pricing.test.ts
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
CREATE TABLE public.price_list (
  work_type_id uuid PRIMARY KEY REFERENCES public.work_types(id),
  price numeric(12,2) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id),

  CONSTRAINT price_list_price_non_negative CHECK (price >= 0)
);

CREATE TABLE public.dentist_discounts (
  dentist_id uuid PRIMARY KEY REFERENCES public.dentists(id),
  discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id),

  CONSTRAINT dentist_discounts_range CHECK (discount_percent BETWEEN 0 AND 100)
);

CREATE TABLE public.case_charges (
  case_id uuid PRIMARY KEY REFERENCES public.cases(id) ON DELETE CASCADE,
  list_price numeric(12,2),                -- NULL = not priced yet
  discount_percent numeric(5,2) NOT NULL DEFAULT 0,
  net_amount numeric(12,2)
    GENERATED ALWAYS AS (round(list_price * (1 - discount_percent / 100), 2)) STORED,
  price_source text NOT NULL DEFAULT 'list',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id),

  CONSTRAINT case_charges_price_non_negative CHECK (list_price IS NULL OR list_price >= 0),
  CONSTRAINT case_charges_discount_range CHECK (discount_percent BETWEEN 0 AND 100),
  CONSTRAINT case_charges_price_source CHECK (price_source IN ('list', 'manual'))
);

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dentist_id uuid NOT NULL REFERENCES public.dentists(id),
  case_id uuid REFERENCES public.cases(id),          -- NULL = on account (e.g. monthly)
  amount numeric(12,2) NOT NULL,
  method text NOT NULL DEFAULT 'cash',
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid REFERENCES public.profiles(id) DEFAULT auth.uid(),
  note text,
  reverses_payment_id uuid REFERENCES public.payments(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT payments_amount_non_zero CHECK (amount <> 0),
  CONSTRAINT payments_sign CHECK (
    (reverses_payment_id IS NULL AND amount > 0) OR (reverses_payment_id IS NOT NULL AND amount < 0)
  ),
  CONSTRAINT payments_method CHECK (method IN ('cash', 'transfer', 'other')),
  CONSTRAINT payments_note_length CHECK (note IS NULL OR char_length(note) <= 2000),
  CONSTRAINT payments_not_self_reversal CHECK (reverses_payment_id IS DISTINCT FROM id)
);

-- At most one reversal per payment (race-safe backstop for the trigger check).
CREATE UNIQUE INDEX payments_one_reversal ON public.payments (reverses_payment_id)
  WHERE reverses_payment_id IS NOT NULL;
CREATE INDEX payments_dentist_received ON public.payments (dentist_id, received_at);
CREATE INDEX payments_case ON public.payments (case_id) WHERE case_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Private helpers (snapshot lookups)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.list_price_for(p_case_type text)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT pl.price
    FROM public.work_types w
    JOIN public.price_list pl ON pl.work_type_id = w.id
   WHERE lower(btrim(w.name)) = lower(btrim(p_case_type))
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION private.discount_for(p_dentist_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT d.discount_percent FROM public.dentist_discounts d WHERE d.dentist_id = p_dentist_id),
    0
  );
$$;

-- The moment a delivered case becomes due (see header).
CREATE OR REPLACE FUNCTION private.case_due_at(p_delivered_at timestamptz, p_created_at timestamptz)
RETURNS timestamptz
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT coalesce(p_delivered_at, p_created_at);
$$;

REVOKE EXECUTE ON FUNCTION private.list_price_for(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.discount_for(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION private.case_due_at(timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- price_list: validate, stamp, audit, price unpriced cases
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_price_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.price IS NULL OR NEW.price < 0 THEN
    RAISE EXCEPTION 'Price must be zero or more' USING HINT = 'err.price.invalid_amount';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.work_type_id := OLD.work_type_id;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_price_list_normalize
  BEFORE INSERT OR UPDATE ON public.price_list
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_price_list();

CREATE OR REPLACE FUNCTION public.after_price_list_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name text;
  v_filled integer := 0;
  v_case_ids jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.price IS NOT DISTINCT FROM OLD.price THEN
    RETURN NULL;
  END IF;

  SELECT w.name INTO v_name FROM public.work_types w WHERE w.id = NEW.work_type_id;

  -- Unpriced, list-sourced, not cancelled charges of this type take the price
  -- and the doctor's current discount (their first real snapshot). Delivered
  -- unpriced cases are included on purpose: they become due at this price.
  WITH priced AS (
    UPDATE public.case_charges cc
       SET list_price = NEW.price,
           discount_percent = private.discount_for(c.dentist_id)
      FROM public.cases c
     WHERE cc.case_id = c.id
       AND cc.list_price IS NULL
       AND cc.price_source = 'list'
       AND c.current_status <> 'cancelled'
       AND lower(btrim(c.case_type)) = lower(btrim(v_name))
    RETURNING cc.case_id
  )
  SELECT count(*)::integer, coalesce(jsonb_agg(priced.case_id), '[]'::jsonb)
    INTO v_filled, v_case_ids
    FROM priced;

  INSERT INTO public.audit_logs (action, actor_id, target_id, target_type, details)
  VALUES (
    'settings_changed',
    auth.uid(),
    NEW.work_type_id,
    'price',
    jsonb_build_object(
      'op', CASE WHEN TG_OP = 'INSERT' THEN 'price_set' ELSE 'price_changed' END,
      'work_type', v_name,
      'price', NEW.price,
      'previous_price', CASE WHEN TG_OP = 'UPDATE' THEN OLD.price END,
      'priced_cases_count', v_filled,
      'priced_case_ids', v_case_ids
    )
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_price_list_after_change
  AFTER INSERT OR UPDATE ON public.price_list
  FOR EACH ROW
  EXECUTE FUNCTION public.after_price_list_change();

-- -----------------------------------------------------------------------------
-- dentist_discounts: validate, stamp, audit (existing charges keep their snapshot)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_dentist_discount()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.discount_percent IS NULL OR NEW.discount_percent < 0 OR NEW.discount_percent > 100 THEN
    RAISE EXCEPTION 'Discount must be between 0 and 100 percent' USING HINT = 'err.discount.invalid_percent';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    NEW.dentist_id := OLD.dentist_id;
  END IF;
  NEW.updated_at := now();
  NEW.updated_by := auth.uid();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_dentist_discounts_normalize
  BEFORE INSERT OR UPDATE ON public.dentist_discounts
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_dentist_discount();

CREATE OR REPLACE FUNCTION public.audit_dentist_discount_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.discount_percent IS NOT DISTINCT FROM OLD.discount_percent THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.audit_logs (action, actor_id, target_id, target_type, details)
  VALUES (
    'settings_changed',
    auth.uid(),
    NEW.dentist_id,
    'dentist_discount',
    jsonb_build_object(
      'op', CASE WHEN TG_OP = 'INSERT' THEN 'discount_set' ELSE 'discount_changed' END,
      'dentist', (SELECT d.name FROM public.dentists d WHERE d.id = NEW.dentist_id),
      'discount_percent', NEW.discount_percent,
      'previous_discount_percent', CASE WHEN TG_OP = 'UPDATE' THEN OLD.discount_percent END
    )
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_dentist_discounts_audit
  AFTER INSERT OR UPDATE ON public.dentist_discounts
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_dentist_discount_change();

-- -----------------------------------------------------------------------------
-- dentist_opening_balances: OPTIONAL balance per doctor for everything before
-- the money module (old deliveries are never charged case by case; the owner
-- decides per doctor). amount > 0: the doctor owes the lab; < 0: credit.
-- It counts on its (Cairo) date as_of. Owner writes; DELETE = "no opening
-- balance"; owner + receptionist read; every change is audited.
-- -----------------------------------------------------------------------------
CREATE TABLE public.dentist_opening_balances (
  dentist_id uuid PRIMARY KEY REFERENCES public.dentists(id),
  amount numeric(12,2) NOT NULL,
  as_of date NOT NULL,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id),

  CONSTRAINT dentist_opening_balances_note_length CHECK (note IS NULL OR char_length(note) <= 2000)
);

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

CREATE TRIGGER trg_opening_balances_normalize
  BEFORE INSERT OR UPDATE ON public.dentist_opening_balances
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_opening_balance();

CREATE OR REPLACE FUNCTION public.audit_opening_balance_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_dentist uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_dentist := OLD.dentist_id;
  ELSE
    v_dentist := NEW.dentist_id;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.amount IS NOT DISTINCT FROM OLD.amount
     AND NEW.as_of IS NOT DISTINCT FROM OLD.as_of AND NEW.note IS NOT DISTINCT FROM OLD.note THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.audit_logs (action, actor_id, target_id, target_type, details)
  VALUES (
    'settings_changed',
    auth.uid(),
    v_dentist,
    'opening_balance',
    jsonb_build_object(
      'op', CASE TG_OP WHEN 'INSERT' THEN 'opening_set' WHEN 'UPDATE' THEN 'opening_changed' ELSE 'opening_removed' END,
      'dentist', (SELECT d.name FROM public.dentists d WHERE d.id = v_dentist),
      'amount', CASE WHEN TG_OP <> 'DELETE' THEN NEW.amount END,
      'as_of', CASE WHEN TG_OP <> 'DELETE' THEN NEW.as_of END,
      'note', CASE WHEN TG_OP <> 'DELETE' THEN NEW.note END,
      'previous_amount', CASE WHEN TG_OP <> 'INSERT' THEN OLD.amount END,
      'previous_as_of', CASE WHEN TG_OP <> 'INSERT' THEN OLD.as_of END
    )
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_opening_balances_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.dentist_opening_balances
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_opening_balance_change();

-- -----------------------------------------------------------------------------
-- case_charges: snapshot on case insert, re-price open cases on type/doctor change
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_case_charge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.case_charges (case_id, list_price, discount_percent, price_source, updated_by)
  VALUES (
    NEW.id,
    private.list_price_for(NEW.case_type),
    private.discount_for(NEW.dentist_id),
    'list',
    auth.uid()
  )
  ON CONFLICT (case_id) DO NOTHING;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_create_case_charge
  AFTER INSERT ON public.cases
  FOR EACH ROW
  EXECUTE FUNCTION public.create_case_charge();

-- A case inserted directly as 'delivered' (trusted SQL; the browser cannot set
-- the status on insert) is stamped now, so its due date never depends on
-- updated_at. Runs after trg_auto_case_number (alphabetical order).
CREATE OR REPLACE FUNCTION public.stamp_delivered_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.current_status = 'delivered' AND NEW.delivered_at IS NULL THEN
    NEW.delivered_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_stamp_delivered_on_insert
  BEFORE INSERT ON public.cases
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_delivered_on_insert();

-- Work type or doctor of a case changed:
-- * any case with payments: the doctor is locked (payments are filed under it);
-- * delivered case: the doctor may be changed only by the owner (or a trusted
--   SQL session, which has no request role); a 'list' charge takes the new
--   doctor's current discount, a 'manual' charge is kept; always audited.
--   A work type change on a delivered case does not re-price it;
-- * open case: a 'list' charge is re-taken from the price list / new doctor's
--   discount and audited when it changes; 'manual' charges are kept;
-- * cancelled case: nothing (never due).
CREATE OR REPLACE FUNCTION public.sync_case_charge_on_case_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_type_changed boolean := NEW.case_type IS DISTINCT FROM OLD.case_type;
  v_dentist_changed boolean := NEW.dentist_id IS DISTINCT FROM OLD.dentist_id;
  v_delivered boolean := NEW.current_status = 'delivered';
  v_old public.case_charges;
  v_new public.case_charges;
BEGIN
  IF v_dentist_changed
     AND EXISTS (SELECT 1 FROM public.payments p WHERE p.case_id = NEW.id) THEN
    RAISE EXCEPTION 'The doctor of a case with payments cannot be changed'
      USING HINT = 'err.case.has_payments';
  END IF;

  IF v_delivered AND v_dentist_changed
     AND private.request_role() IS NOT NULL
     AND NOT private.caller_has_role(ARRAY['owner']::public.app_role[]) THEN
    RAISE EXCEPTION 'Only the owner can change the doctor of a delivered case'
      USING HINT = 'err.case.delivered_dentist_locked';
  END IF;

  IF NEW.current_status = 'cancelled' OR (v_delivered AND NOT v_dentist_changed) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_old FROM public.case_charges cc WHERE cc.case_id = NEW.id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL; -- delivered/cancelled before 015: no charge
  END IF;

  IF v_old.price_source = 'list' THEN
    UPDATE public.case_charges cc
       SET list_price = CASE WHEN v_type_changed AND NOT v_delivered
                             THEN private.list_price_for(NEW.case_type) ELSE cc.list_price END,
           discount_percent = CASE WHEN v_dentist_changed
                                   THEN private.discount_for(NEW.dentist_id) ELSE cc.discount_percent END
     WHERE cc.case_id = NEW.id
    RETURNING * INTO v_new;
  ELSE
    v_new := v_old;
  END IF;

  IF v_delivered
     OR v_new.list_price IS DISTINCT FROM v_old.list_price
     OR v_new.discount_percent IS DISTINCT FROM v_old.discount_percent THEN
    INSERT INTO public.audit_logs (action, actor_id, target_id, target_type, details)
    VALUES (
      'settings_changed',
      auth.uid(),
      NEW.id,
      'case_price',
      jsonb_build_object(
        'op', CASE WHEN v_delivered THEN 'case_dentist_changed' ELSE 'case_repriced' END,
        'case_number', NEW.case_number,
        'status', NEW.current_status,
        'previous_dentist_id', OLD.dentist_id,
        'dentist_id', NEW.dentist_id,
        'previous_work_type', OLD.case_type,
        'work_type', NEW.case_type,
        'price_source', v_new.price_source,
        'previous_list_price', v_old.list_price,
        'list_price', v_new.list_price,
        'previous_discount_percent', v_old.discount_percent,
        'discount_percent', v_new.discount_percent,
        'previous_net_amount', v_old.net_amount,
        'net_amount', v_new.net_amount
      )
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_case_charge
  AFTER UPDATE OF case_type, dentist_id ON public.cases
  FOR EACH ROW
  WHEN (OLD.case_type IS DISTINCT FROM NEW.case_type OR OLD.dentist_id IS DISTINCT FROM NEW.dentist_id)
  EXECUTE FUNCTION public.sync_case_charge_on_case_change();

-- Edits of a charge. A DIRECT UPDATE of case_charges (pg_trigger_depth() = 1:
-- the owner from the browser, or anyone in the SQL editor) marks the price
-- 'manual' and is audited below. Updates made by the triggers above (price
-- list fill, work type/doctor change) run at depth > 1 and keep 'list'; they
-- write their own audit rows. Browser clients can only UPDATE
-- list_price/discount_percent (column grant below); everything else is fixed here.
CREATE OR REPLACE FUNCTION public.guard_case_charge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.case_id := OLD.case_id;

  IF NEW.list_price IS NOT NULL AND NEW.list_price < 0 THEN
    RAISE EXCEPTION 'Price must be zero or more' USING HINT = 'err.price.invalid_amount';
  END IF;
  IF NEW.discount_percent IS NULL OR NEW.discount_percent < 0 OR NEW.discount_percent > 100 THEN
    RAISE EXCEPTION 'Discount must be between 0 and 100 percent' USING HINT = 'err.discount.invalid_percent';
  END IF;

  IF NEW.list_price IS DISTINCT FROM OLD.list_price
     OR NEW.discount_percent IS DISTINCT FROM OLD.discount_percent THEN
    NEW.updated_at := now();
    NEW.updated_by := auth.uid();
    IF pg_trigger_depth() = 1 THEN
      NEW.price_source := 'manual';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_case_charges_guard
  BEFORE UPDATE ON public.case_charges
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_case_charge();

CREATE OR REPLACE FUNCTION public.audit_case_charge_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only direct edits (depth 1). Trigger-driven re-pricing is audited by the
  -- price_list and case triggers that cause it.
  IF pg_trigger_depth() <> 1
     OR (NEW.list_price IS NOT DISTINCT FROM OLD.list_price
         AND NEW.discount_percent IS NOT DISTINCT FROM OLD.discount_percent) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.audit_logs (action, actor_id, target_id, target_type, details)
  VALUES (
    'settings_changed',
    auth.uid(),
    NEW.case_id,
    'case_price',
    jsonb_build_object(
      'op', 'case_price_changed',
      'case_number', (SELECT c.case_number FROM public.cases c WHERE c.id = NEW.case_id),
      'list_price', NEW.list_price,
      'discount_percent', NEW.discount_percent,
      'net_amount', NEW.net_amount,
      'previous_list_price', OLD.list_price,
      'previous_discount_percent', OLD.discount_percent
    )
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_case_charges_audit
  AFTER UPDATE ON public.case_charges
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_case_charge_change();

-- -----------------------------------------------------------------------------
-- payments: validate (incl. reversal rules), stamp, audit
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_orig public.payments;
  v_case_dentist uuid;
  v_case_status public.case_status;
BEGIN
  -- Every API request (anon, authenticated, service_role) must be an active
  -- owner/receptionist, and who/when is set by the database (no back-dating).
  -- Only trusted direct sessions (SQL editor, seeds: no request role) may set them.
  IF private.request_role() IS NOT NULL THEN
    IF NOT private.caller_has_role(ARRAY['owner', 'receptionist']::public.app_role[]) THEN
      RAISE EXCEPTION 'Not permitted to record payments' USING HINT = 'err.money.forbidden';
    END IF;
    NEW.received_by := auth.uid();
    NEW.received_at := now();
    NEW.created_at := now();
  END IF;

  NEW.note := nullif(btrim(coalesce(NEW.note, '')), '');
  IF NEW.note IS NOT NULL AND char_length(NEW.note) > 2000 THEN
    RAISE EXCEPTION 'Note is too long' USING HINT = 'err.validation.too_long';
  END IF;

  IF NEW.reverses_payment_id IS NULL THEN
    IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
      RAISE EXCEPTION 'Payment amount must be more than zero' USING HINT = 'err.payment.invalid_amount';
    END IF;
  ELSE
    -- Lock the original so two reversals of it cannot pass this check together.
    SELECT * INTO v_orig FROM public.payments p WHERE p.id = NEW.reverses_payment_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Payment to reverse not found' USING HINT = 'err.payment.not_found';
    END IF;
    IF v_orig.reverses_payment_id IS NOT NULL THEN
      RAISE EXCEPTION 'A reversal cannot be reversed' USING HINT = 'err.payment.cannot_reverse_reversal';
    END IF;
    IF EXISTS (SELECT 1 FROM public.payments p WHERE p.reverses_payment_id = v_orig.id) THEN
      RAISE EXCEPTION 'Payment already reversed' USING HINT = 'err.payment.already_reversed';
    END IF;
    IF NEW.amount IS DISTINCT FROM -v_orig.amount THEN
      RAISE EXCEPTION 'A reversal must be exactly minus the original amount'
        USING HINT = 'err.payment.reversal_amount';
    END IF;
    -- Doctor, case and method come from the original. A reversal stays allowed
    -- even if that case was cancelled since (the case checks below are skipped).
    NEW.dentist_id := v_orig.dentist_id;
    NEW.case_id := v_orig.case_id;
    NEW.method := v_orig.method;
    RETURN NEW;
  END IF;

  IF NEW.method IS NULL OR NEW.method NOT IN ('cash', 'transfer', 'other') THEN
    RAISE EXCEPTION 'Unknown payment method' USING HINT = 'err.payment.invalid_method';
  END IF;

  IF NEW.case_id IS NOT NULL THEN
    -- FOR SHARE conflicts with the row lock of a concurrent UPDATE of the case,
    -- so a doctor change and a payment on the same case cannot both commit
    -- (the later one re-checks: err.case.has_payments or case_dentist_mismatch).
    SELECT c.dentist_id, c.current_status INTO v_case_dentist, v_case_status
      FROM public.cases c
     WHERE c.id = NEW.case_id
       FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Case not found' USING HINT = 'err.case.not_found';
    END IF;
    IF v_case_dentist IS DISTINCT FROM NEW.dentist_id THEN
      RAISE EXCEPTION 'The case belongs to another doctor' USING HINT = 'err.payment.case_dentist_mismatch';
    END IF;
    IF v_case_status = 'cancelled'
       OR NOT EXISTS (SELECT 1 FROM public.case_charges cc WHERE cc.case_id = NEW.case_id) THEN
      RAISE EXCEPTION 'Payments can only be recorded on a billable case'
        USING HINT = 'err.payment.case_not_billable';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_payments_validate
  BEFORE INSERT ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_payment();

-- Append-only for EVERY role, including the database owner (dashboard / SQL
-- editor). Restores load data with COPY into fresh tables (triggers are created
-- after the data), so they are not affected.
CREATE OR REPLACE FUNCTION public.payments_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Payments cannot be changed or deleted; record a reversal instead'
    USING HINT = 'err.payment.append_only';
END;
$$;

CREATE TRIGGER trg_payments_no_update_delete
  BEFORE UPDATE OR DELETE ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.payments_append_only();

CREATE TRIGGER trg_payments_no_truncate
  BEFORE TRUNCATE ON public.payments
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.payments_append_only();

CREATE OR REPLACE FUNCTION public.audit_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.audit_logs (action, actor_id, target_id, target_type, details)
  VALUES (
    'system_event',
    auth.uid(),
    NEW.id,
    'payment',
    jsonb_build_object(
      'op', CASE WHEN NEW.reverses_payment_id IS NULL THEN 'payment_recorded' ELSE 'payment_reversed' END,
      'dentist_id', NEW.dentist_id,
      'case_id', NEW.case_id,
      'amount', NEW.amount,
      'method', NEW.method,
      'reverses_payment_id', NEW.reverses_payment_id
    )
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_payments_audit
  AFTER INSERT ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_payment();

-- -----------------------------------------------------------------------------
-- RLS and privileges: owner + receptionist read; anon, technician,
-- representative and inactive users get nothing.
-- -----------------------------------------------------------------------------
ALTER TABLE public.price_list ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dentist_discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dentist_opening_balances ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.price_list, public.dentist_discounts, public.case_charges, public.payments,
  public.dentist_opening_balances FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dentist_opening_balances TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.price_list TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.dentist_discounts TO authenticated;
GRANT SELECT ON public.case_charges TO authenticated;
GRANT UPDATE (list_price, discount_percent) ON public.case_charges TO authenticated;
GRANT SELECT, INSERT ON public.payments TO authenticated;
-- The service role never writes money (the app does not use it for this).
-- Payments are append-only for it too.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON public.price_list, public.dentist_discounts, public.case_charges, public.payments,
     public.dentist_opening_balances
  FROM service_role;

CREATE POLICY price_list_select ON public.price_list
  FOR SELECT TO authenticated
  USING ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) IN ('owner', 'receptionist'), false));
CREATE POLICY price_list_insert ON public.price_list
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) = 'owner', false));
CREATE POLICY price_list_update ON public.price_list
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) = 'owner', false))
  WITH CHECK ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) = 'owner', false));

CREATE POLICY dentist_discounts_select ON public.dentist_discounts
  FOR SELECT TO authenticated
  USING ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) IN ('owner', 'receptionist'), false));
CREATE POLICY dentist_discounts_insert ON public.dentist_discounts
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) = 'owner', false));
CREATE POLICY dentist_discounts_update ON public.dentist_discounts
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) = 'owner', false))
  WITH CHECK ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) = 'owner', false));

CREATE POLICY case_charges_select ON public.case_charges
  FOR SELECT TO authenticated
  USING ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) IN ('owner', 'receptionist'), false));
CREATE POLICY case_charges_update ON public.case_charges
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) = 'owner', false))
  WITH CHECK ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) = 'owner', false));

CREATE POLICY payments_select ON public.payments
  FOR SELECT TO authenticated
  USING ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) IN ('owner', 'receptionist'), false));
CREATE POLICY payments_insert ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) IN ('owner', 'receptionist'), false));
-- No UPDATE/DELETE policies on payments, and no DELETE policies on price_list,
-- dentist_discounts and case_charges: those rows are never removed from the app.

CREATE POLICY opening_balances_select ON public.dentist_opening_balances
  FOR SELECT TO authenticated
  USING ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) IN ('owner', 'receptionist'), false));
CREATE POLICY opening_balances_insert ON public.dentist_opening_balances
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) = 'owner', false));
CREATE POLICY opening_balances_update ON public.dentist_opening_balances
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) = 'owner', false))
  WITH CHECK ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) = 'owner', false));
-- Deleting the row means "no opening balance"; audited like any change.
CREATE POLICY opening_balances_delete ON public.dentist_opening_balances
  FOR DELETE TO authenticated
  USING ((SELECT public.is_user_active()) AND coalesce((SELECT public.get_user_role()) = 'owner', false));

-- -----------------------------------------------------------------------------
-- Existing open cases get a charge row (unpriced: the price list is empty at
-- this point; the doctor's discount, if any, is taken like for a new case).
-- -----------------------------------------------------------------------------
INSERT INTO public.case_charges (case_id, list_price, discount_percent, price_source)
SELECT c.id, private.list_price_for(c.case_type), private.discount_for(c.dentist_id), 'list'
  FROM public.cases c
 WHERE c.current_status NOT IN ('delivered', 'cancelled')
ON CONFLICT (case_id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- Read RPCs (owner + receptionist; dashboard: owner)
-- -----------------------------------------------------------------------------

-- Ledger of one doctor: delivered cases (debit = net amount, NULL when not
-- priced), payments (credit) / reversals (debit) and the optional opening
-- balance (debit if > 0, credit if < 0), with the Cairo date.
CREATE OR REPLACE FUNCTION private.dentist_ledger(p_dentist_id uuid)
RETURNS TABLE (
  kind text,
  occurred_at timestamptz,
  day date,
  case_id uuid,
  case_number text,
  patient_name text,
  work_type text,
  list_price numeric,
  discount_percent numeric,
  payment_id uuid,
  method text,
  note text,
  reverses_payment_id uuid,
  debit numeric,
  credit numeric,
  priced boolean
)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT 'charge',
         private.case_due_at(c.delivered_at, c.created_at),
         private.cairo_date(private.case_due_at(c.delivered_at, c.created_at)),
         c.id, c.case_number, c.patient_name, c.case_type,
         cc.list_price, cc.discount_percent,
         NULL::uuid, NULL::text, NULL::text, NULL::uuid,
         cc.net_amount, NULL::numeric,
         cc.net_amount IS NOT NULL
    FROM public.cases c
    JOIN public.case_charges cc ON cc.case_id = c.id
   WHERE c.dentist_id = p_dentist_id
     AND c.current_status = 'delivered'
  UNION ALL
  SELECT CASE WHEN p.reverses_payment_id IS NULL THEN 'payment' ELSE 'reversal' END,
         p.received_at,
         private.cairo_date(p.received_at),
         p.case_id, c.case_number, c.patient_name, c.case_type,
         NULL::numeric, NULL::numeric,
         p.id, p.method, p.note, p.reverses_payment_id,
         CASE WHEN p.amount < 0 THEN -p.amount END,
         CASE WHEN p.amount > 0 THEN p.amount END,
         true
    FROM public.payments p
    LEFT JOIN public.cases c ON c.id = p.case_id
   WHERE p.dentist_id = p_dentist_id
  UNION ALL
  -- Optional opening balance: one line at Cairo midnight of as_of
  -- (so it comes before anything else on that day).
  SELECT 'opening',
         (ob.as_of::timestamp AT TIME ZONE 'Africa/Cairo'),
         ob.as_of,
         NULL::uuid, NULL::text, NULL::text, NULL::text,
         NULL::numeric, NULL::numeric,
         NULL::uuid, NULL::text, ob.note, NULL::uuid,
         CASE WHEN ob.amount > 0 THEN ob.amount END,
         CASE WHEN ob.amount < 0 THEN -ob.amount END,
         true
    FROM public.dentist_opening_balances ob
   WHERE ob.dentist_id = p_dentist_id;
$$;

REVOKE EXECUTE ON FUNCTION private.dentist_ledger(uuid) FROM PUBLIC, anon, authenticated;

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

-- One row per doctor (all doctors, active or not).
CREATE OR REPLACE FUNCTION public.get_dentist_balances()
RETURNS TABLE (
  dentist_id uuid,
  dentist_name text,
  clinic_name text,
  is_active boolean,
  total_due numeric,
  total_paid numeric,
  balance numeric,
  unpriced_delivered_count integer,
  last_payment_at timestamptz,
  opening_balance numeric,
  opening_as_of date
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.caller_has_role(ARRAY['owner', 'receptionist']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not permitted to view accounts' USING HINT = 'err.money.forbidden';
  END IF;

  RETURN QUERY
  WITH due AS (
    SELECT c.dentist_id AS d_id,
           coalesce(sum(cc.net_amount), 0) AS due_sum,
           (count(*) FILTER (WHERE cc.net_amount IS NULL))::integer AS unpriced
      FROM public.cases c
      JOIN public.case_charges cc ON cc.case_id = c.id
     WHERE c.current_status = 'delivered'
       AND c.dentist_id IS NOT NULL
     GROUP BY c.dentist_id
  ), paid AS (
    -- last_at: latest payment that is not a reversal and was not reversed.
    -- (At most one reversal per payment, so the join does not duplicate rows.)
    SELECT p.dentist_id AS d_id,
           sum(p.amount) AS paid_sum,
           max(p.received_at) FILTER (WHERE p.reverses_payment_id IS NULL AND r.id IS NULL) AS last_at
      FROM public.payments p
      LEFT JOIN public.payments r ON r.reverses_payment_id = p.id
     GROUP BY p.dentist_id
  )
  SELECT d.id,
         d.name,
         d.clinic_name,
         d.is_active,
         coalesce(due.due_sum, 0)::numeric(12,2),
         coalesce(paid.paid_sum, 0)::numeric(12,2),
         (coalesce(ob.amount, 0) + coalesce(due.due_sum, 0) - coalesce(paid.paid_sum, 0))::numeric(12,2),
         coalesce(due.unpriced, 0),
         paid.last_at,
         ob.amount,
         ob.as_of
    FROM public.dentists d
    LEFT JOIN due ON due.d_id = d.id
    LEFT JOIN paid ON paid.d_id = d.id
    LEFT JOIN public.dentist_opening_balances ob ON ob.dentist_id = d.id
   ORDER BY 7 DESC, d.name;
END;
$$;

-- Price and collection status of one case (for per-case collection).
-- is_due: delivered AND has a doctor (it counts in that doctor's balance).
-- remaining: net - paid only when due and priced; NULL otherwise (open,
-- cancelled, doctor-less or unpriced cases owe nothing yet). paid is always
-- returned, so a payment on a cancelled case stays visible.
CREATE OR REPLACE FUNCTION public.get_case_balance(p_case_id uuid)
RETURNS TABLE (
  case_id uuid,
  dentist_id uuid,
  list_price numeric,
  discount_percent numeric,
  net_amount numeric,
  price_source text,
  is_priced boolean,
  is_due boolean,
  paid numeric,
  remaining numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.caller_has_role(ARRAY['owner', 'receptionist']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not permitted to view accounts' USING HINT = 'err.money.forbidden';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.id = p_case_id) THEN
    RAISE EXCEPTION 'Case not found' USING HINT = 'err.case.not_found';
  END IF;

  RETURN QUERY
  WITH pay AS (
    SELECT coalesce(sum(p.amount), 0) AS s FROM public.payments p WHERE p.case_id = p_case_id
  )
  SELECT c.id,
         c.dentist_id,
         cc.list_price,
         cc.discount_percent,
         cc.net_amount,
         cc.price_source,
         coalesce(cc.net_amount IS NOT NULL, false),
         (c.current_status = 'delivered' AND c.dentist_id IS NOT NULL),
         pay.s::numeric(12,2),
         CASE WHEN c.current_status = 'delivered' AND c.dentist_id IS NOT NULL
              THEN (cc.net_amount - pay.s)::numeric(12,2) END
    FROM public.cases c
    LEFT JOIN public.case_charges cc ON cc.case_id = c.id
   CROSS JOIN pay
   WHERE c.id = p_case_id;
END;
$$;

-- KNOWN_ISSUES #16: everything the owner dashboard counts, in one call.
-- Same numbers as the old per-status queries; "overdue" uses the Cairo date
-- (as get_late_case_counts in 013). Plus the money owed to the lab.
CREATE OR REPLACE FUNCTION public.get_owner_dashboard_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_today date := private.cairo_date(now());
  v_counts jsonb;
BEGIN
  IF NOT private.caller_has_role(ARRAY['owner']::public.app_role[]) THEN
    RAISE EXCEPTION 'Owner only' USING HINT = 'err.auth.owner_only';
  END IF;

  SELECT jsonb_object_agg(s.status::text, coalesce(n.cnt, 0))
    INTO v_counts
    FROM unnest(enum_range(NULL::public.case_status)) AS s(status)
    LEFT JOIN (
      SELECT c.current_status, count(*)::integer AS cnt
        FROM public.cases c
       GROUP BY c.current_status
    ) n ON n.current_status = s.status;

  RETURN v_counts || jsonb_build_object(
    'total', (SELECT count(*) FROM public.cases)::integer,
    'overdue', (SELECT count(*) FROM public.cases c
                 WHERE c.due_date < v_today
                   AND c.current_status NOT IN ('delivered', 'cancelled'))::integer,
    'active_employees', (SELECT count(*) FROM public.profiles p WHERE p.status = 'active')::integer,
    'total_outstanding', (
      (SELECT coalesce(sum(cc.net_amount), 0)
         FROM public.case_charges cc
         JOIN public.cases c ON c.id = cc.case_id
        WHERE c.current_status = 'delivered' AND c.dentist_id IS NOT NULL)
      - (SELECT coalesce(sum(p.amount), 0) FROM public.payments p)
      + (SELECT coalesce(sum(ob.amount), 0) FROM public.dentist_opening_balances ob)
    )::numeric(12,2),
    'unpriced_delivered_count', (SELECT count(*)
         FROM public.case_charges cc
         JOIN public.cases c ON c.id = cc.case_id
        WHERE c.current_status = 'delivered' AND c.dentist_id IS NOT NULL
          AND cc.net_amount IS NULL)::integer,
    -- Delivered cases with a charge but no doctor: owed by nobody in the system.
    'delivered_without_dentist_count', (SELECT count(*)
         FROM public.case_charges cc
         JOIN public.cases c ON c.id = cc.case_id
        WHERE c.current_status = 'delivered' AND c.dentist_id IS NULL)::integer
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges (003 pattern)
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.normalize_price_list() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.after_price_list_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.normalize_dentist_discount() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_dentist_discount_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_case_charge() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_case_charge_on_case_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_case_charge() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_case_charge_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_payment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_payment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.stamp_delivered_on_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.payments_append_only() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.normalize_opening_balance() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_opening_balance_change() FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_dentist_statement(uuid, date, date) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_dentist_balances() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_case_balance(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_owner_dashboard_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_dentist_statement(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dentist_balances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_case_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_owner_dashboard_stats() TO authenticated;
