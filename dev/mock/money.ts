/**
 * DEV-ONLY fake money data and RPCs for `npm run dev:mock` (migrations 015/016).
 * Same role rules as the database: owner + receptionist read money, the owner sets
 * prices / discounts / opening balances / case prices, payments are append-only.
 * JS arithmetic is fine here: this file never ships and only fakes the server.
 */
import { cairoToday } from '@/lib/utils';
import type {
  AppRole,
  CaseBalance,
  CaseCharge,
  CaseStatus,
  DentistBalance,
  DentistDiscount,
  DentistOpeningBalance,
  DentistStatement,
  Payment,
  PriceListEntry,
  StatementLine,
} from '@/types/database';
import { CASES, DENTISTS, PROFILES, WORK_TYPES } from './fixtures';

type Row = Record<string, unknown>;
type DbError = { code: string; message: string; hint?: string; details?: string | null };

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();

export const PRICE_LIST: PriceListEntry[] = [
  { work_type_id: 'wt1', price: 1500, updated_at: daysAgo(20), updated_by: 'u-owner' },
];

export const DENTIST_DISCOUNTS: DentistDiscount[] = [
  { dentist_id: 'd1', discount_percent: 10, updated_at: daysAgo(20), updated_by: 'u-owner' },
];

export const OPENING_BALANCES: DentistOpeningBalance[] = [
  { dentist_id: 'd2', amount: 2500, as_of: daysAgo(40).slice(0, 10), note: 'رصيد قبل بدء الحسابات في النظام', updated_at: daysAgo(40), updated_by: 'u-owner' },
  { dentist_id: 'd3', amount: -300, as_of: daysAgo(40).slice(0, 10), note: null, updated_at: daysAgo(40), updated_by: 'u-owner' },
];

const charge = (case_id: string, list_price: number | null, discount_percent = 0, price_source: CaseCharge['price_source'] = 'list'): CaseCharge => ({
  case_id,
  list_price,
  discount_percent,
  net_amount: list_price === null ? null : Math.round(list_price * (100 - discount_percent)) / 100,
  price_source,
  updated_at: daysAgo(3),
  updated_by: 'u-owner',
});

// Fixture cases use old prosthetic type names, so most are unpriced.
export const CASE_CHARGES: CaseCharge[] = CASES.map((c) => charge(c.id, null, c.dentist_id === 'd1' ? 10 : 0));
const setCharge = (id: string, c: CaseCharge) => {
  const i = CASE_CHARGES.findIndex((x) => x.case_id === id);
  if (i >= 0) CASE_CHARGES[i] = c;
};
setCharge('c12', charge('c12', 1200, 10, 'manual')); // delivered, Dr. Mona
setCharge('c11', charge('c11', 1500, 10)); // with representative
setCharge('c10', charge('c10', 1500)); // awaiting pickup, Dr. Sarah

// Two more delivered cases so the accounts have something to show.
const extraDelivered = (id: string, n: number, patient: string, dentistId: string, days: number) => {
  const base = CASES.find((c) => c.id === 'c12')!;
  CASES.push({
    ...base,
    id,
    case_number: `CASE-202610-${String(n).padStart(5, '0')}`,
    patient_name: patient,
    dentist_id: dentistId,
    dentist: DENTISTS.find((d) => d.id === dentistId),
    case_type: WORK_TYPES[0].name,
    delivered_at: daysAgo(days),
    created_at: daysAgo(days + 10),
  });
};
extraDelivered('c90', 90, 'Nadia Samir', 'd2', 6);
extraDelivered('c91', 91, 'مصطفى كمال', 'd2', 2);
CASE_CHARGES.push(charge('c90', 1500), charge('c91', null));

export const PAYMENTS: Payment[] = [
  { id: 'p1', dentist_id: 'd1', case_id: 'c12', amount: 500, method: 'cash', received_at: daysAgo(1), received_by: 'u-recep', note: null, reverses_payment_id: null, created_at: daysAgo(1) },
  { id: 'p2', dentist_id: 'd2', case_id: null, amount: 1000, method: 'transfer', received_at: daysAgo(5), received_by: 'u-owner', note: 'تحويل بنكي', reverses_payment_id: null, created_at: daysAgo(5) },
  { id: 'p3', dentist_id: 'd2', case_id: null, amount: 200, method: 'cash', received_at: daysAgo(4), received_by: 'u-recep', note: null, reverses_payment_id: null, created_at: daysAgo(4) },
  { id: 'p4', dentist_id: 'd2', case_id: null, amount: -200, method: 'cash', received_at: daysAgo(3), received_by: 'u-owner', note: 'سُجّلت بالخطأ', reverses_payment_id: 'p3', created_at: daysAgo(3) },
];

export const MONEY_TABLES: Record<string, Row[]> = {
  price_list: PRICE_LIST as unknown as Row[],
  dentist_discounts: DENTIST_DISCOUNTS as unknown as Row[],
  dentist_opening_balances: OPENING_BALANCES as unknown as Row[],
  case_charges: CASE_CHARGES as unknown as Row[],
  payments: PAYMENTS as unknown as Row[],
};

const OWNER_WRITES = new Set(['price_list', 'dentist_discounts', 'dentist_opening_balances', 'case_charges']);

export const err = (hint: string, message: string, code = 'P0001'): DbError => ({ code, message, hint, details: null });

export function canReadMoney(role: AppRole | undefined) {
  return role === 'owner' || role === 'receptionist';
}

/** Same write rules as RLS + triggers. Returns an error, or null when allowed (payload may be adjusted). */
export function checkMoneyWrite(table: string, op: 'insert' | 'update' | 'upsert' | 'delete', role: AppRole | undefined, payload: Row, userId: string | null): DbError | null {
  if (!canReadMoney(role)) return err('', 'permission denied', '42501');
  if (OWNER_WRITES.has(table) && role !== 'owner') return err('', 'new row violates row-level security policy', '42501');
  if (table === 'payments') {
    if (op !== 'insert') return err('err.payment.append_only', 'Payments are append-only');
    if (PAYMENTS.some((p) => p.id === payload.id)) {
      return { code: '23505', message: 'duplicate key value violates unique constraint "payments_pkey"', details: null };
    }
    if (payload.reverses_payment_id) {
      const orig = PAYMENTS.find((p) => p.id === payload.reverses_payment_id);
      if (!orig) return err('err.payment.not_found', 'not found');
      if (orig.reverses_payment_id) return err('err.payment.cannot_reverse_reversal', 'reversal');
      if (PAYMENTS.some((p) => p.reverses_payment_id === orig.id)) return err('err.payment.already_reversed', 'already reversed');
      if (Number(payload.amount) !== -orig.amount) return err('err.payment.reversal_amount', 'amount');
      Object.assign(payload, { dentist_id: orig.dentist_id, case_id: orig.case_id, method: orig.method });
    } else {
      if (!(Number(payload.amount) > 0)) return err('err.payment.invalid_amount', 'amount');
      if (payload.case_id) {
        const c = CASES.find((x) => x.id === payload.case_id);
        if (!c || c.dentist_id !== payload.dentist_id) return err('err.payment.case_dentist_mismatch', 'mismatch');
        if (c.current_status === 'cancelled') return err('err.payment.case_not_billable', 'not billable');
      }
    }
    Object.assign(payload, {
      amount: Number(payload.amount),
      received_at: new Date().toISOString(),
      received_by: userId,
      created_at: new Date().toISOString(),
      note: payload.note ?? null,
      case_id: payload.case_id ?? null,
      reverses_payment_id: payload.reverses_payment_id ?? null,
    });
  }
  if (table === 'dentist_opening_balances' && op !== 'delete') {
    if (Number(payload.amount) === 0) return err('err.opening_balance.zero_amount', 'zero');
    if (String(payload.as_of) > cairoToday()) return err('err.opening_balance.future_date', 'future');
    payload.amount = Number(payload.amount);
  }
  if (table === 'price_list') payload.price = Number(payload.price);
  if (table === 'dentist_discounts') payload.discount_percent = Number(payload.discount_percent);
  if (table === 'case_charges') {
    const lp = payload.list_price === null || payload.list_price === undefined ? null : Number(payload.list_price);
    const dp = Number(payload.discount_percent ?? 0);
    Object.assign(payload, charge(String(payload.case_id ?? ''), lp, dp, 'manual'));
    delete payload.case_id;
  }
  if (op !== 'delete') Object.assign(payload, { updated_at: new Date().toISOString(), updated_by: userId });
  return null;
}

/** Charge snapshot for a case registered in the mock (as trg_create_case_charge). */
export function snapshotCharge(caseId: string, caseType: string, dentistId: string | null) {
  const wt = WORK_TYPES.find((w) => w.name.trim().toLowerCase() === caseType.trim().toLowerCase());
  const price = PRICE_LIST.find((p) => p.work_type_id === wt?.id)?.price ?? null;
  const discount = DENTIST_DISCOUNTS.find((d) => d.dentist_id === dentistId)?.discount_percent ?? 0;
  CASE_CHARGES.push(charge(caseId, price, discount));
}

// ---- RPCs -------------------------------------------------------------------

const cairoDate = (iso: string) => cairoToday(new Date(iso));
const cairoMidnight = (date: string) => new Date(`${date}T00:00:00+02:00`).toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;

function ledger(dentistId: string): StatementLine[] {
  const lines: StatementLine[] = [];
  const ob = OPENING_BALANCES.find((o) => o.dentist_id === dentistId);
  const base = { case_id: null, case_number: null, patient_name: null, work_type: null, list_price: null, discount_percent: null,
    payment_id: null, method: null, note: null, reverses_payment_id: null, debit: null, credit: null, priced: true, is_reversed: false, balance: 0 };
  if (ob) {
    lines.push({ ...base, kind: 'opening', at: cairoMidnight(ob.as_of), date: ob.as_of, note: ob.note,
      debit: ob.amount > 0 ? ob.amount : null, credit: ob.amount < 0 ? -ob.amount : null });
  }
  for (const c of CASES.filter((x) => x.dentist_id === dentistId && x.current_status === 'delivered')) {
    const ch = CASE_CHARGES.find((x) => x.case_id === c.id);
    if (!ch) continue;
    const at = c.delivered_at ?? c.created_at;
    lines.push({ ...base, kind: 'charge', at, date: cairoDate(at), case_id: c.id, case_number: c.case_number,
      patient_name: c.patient_name, work_type: c.case_type, list_price: ch.list_price, discount_percent: ch.discount_percent,
      debit: ch.net_amount, priced: ch.net_amount !== null });
  }
  for (const p of PAYMENTS.filter((x) => x.dentist_id === dentistId)) {
    const c = CASES.find((x) => x.id === p.case_id);
    lines.push({ ...base, kind: p.reverses_payment_id ? 'reversal' : 'payment', at: p.received_at, date: cairoDate(p.received_at),
      case_id: p.case_id, case_number: c?.case_number ?? null, patient_name: c?.patient_name ?? null, work_type: c?.case_type ?? null,
      payment_id: p.id, method: p.method, note: p.note, reverses_payment_id: p.reverses_payment_id,
      debit: p.amount < 0 ? -p.amount : null, credit: p.amount > 0 ? p.amount : null,
      is_reversed: !p.reverses_payment_id && PAYMENTS.some((r) => r.reverses_payment_id === p.id) });
  }
  return lines.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

const effect = (l: StatementLine) => (l.debit ?? 0) - (l.credit ?? 0);

function balances(): DentistBalance[] {
  return DENTISTS.map((d) => {
    const lines = ledger(d.id);
    const due = lines.filter((l) => l.kind === 'charge').reduce((s, l) => s + (l.debit ?? 0), 0);
    const paid = PAYMENTS.filter((p) => p.dentist_id === d.id).reduce((s, p) => s + p.amount, 0);
    const ob = OPENING_BALANCES.find((o) => o.dentist_id === d.id);
    const live = PAYMENTS.filter((p) => p.dentist_id === d.id && !p.reverses_payment_id && !PAYMENTS.some((r) => r.reverses_payment_id === p.id));
    return {
      dentist_id: d.id, dentist_name: d.name, clinic_name: d.clinic_name, is_active: d.is_active,
      total_due: round2(due), total_paid: round2(paid), balance: round2((ob?.amount ?? 0) + due - paid),
      unpriced_delivered_count: lines.filter((l) => l.kind === 'charge' && !l.priced).length,
      last_payment_at: live.map((p) => p.received_at).sort().at(-1) ?? null,
      opening_balance: ob?.amount ?? null, opening_as_of: ob?.as_of ?? null,
    };
  }).sort((a, b) => b.balance - a.balance || a.dentist_name.localeCompare(b.dentist_name));
}

function statement(dentistId: string, from: string, to: string): DentistStatement | DbError {
  if (!from || !to || from > to) return err('err.statement.invalid_period', 'period');
  const d = DENTISTS.find((x) => x.id === dentistId);
  if (!d) return err('err.dentist.not_found', 'not found');
  const all = ledger(dentistId);
  const opening = round2(all.filter((l) => l.date < from).reduce((s, l) => s + effect(l), 0));
  let running = opening;
  const lines = all.filter((l) => l.date >= from && l.date <= to).map((l) => {
    running = round2(running + effect(l));
    return { ...l, balance: running };
  });
  const totalDebit = round2(lines.reduce((s, l) => s + (l.debit ?? 0), 0));
  const totalCredit = round2(lines.reduce((s, l) => s + (l.credit ?? 0), 0));
  return {
    dentist: { id: d.id, name: d.name, clinic_name: d.clinic_name, phone: d.phone },
    from, to, opening_balance: opening, total_debit: totalDebit, total_credit: totalCredit,
    closing_balance: round2(opening + totalDebit - totalCredit),
    unpriced_count: lines.filter((l) => !l.priced).length, lines,
  };
}

function caseBalance(caseId: string): CaseBalance | DbError {
  const c = CASES.find((x) => x.id === caseId);
  if (!c) return err('err.case.not_found', 'not found');
  const ch = CASE_CHARGES.find((x) => x.case_id === caseId);
  const paid = round2(PAYMENTS.filter((p) => p.case_id === caseId).reduce((s, p) => s + p.amount, 0));
  const isDue = c.current_status === 'delivered' && !!c.dentist_id;
  return {
    case_id: c.id, dentist_id: c.dentist_id, list_price: ch?.list_price ?? null, discount_percent: ch?.discount_percent ?? null,
    net_amount: ch?.net_amount ?? null, price_source: ch?.price_source ?? null, is_priced: ch?.net_amount != null,
    is_due: isDue, paid, remaining: isDue && ch?.net_amount != null ? round2(ch.net_amount - paid) : null,
  };
}

function dashboardStats() {
  const statuses: CaseStatus[] = ['intake_pending', 'registered', 'awaiting_assignment', 'assigned', 'in_progress', 'completed',
    'awaiting_reception_receipt', 'received_by_reception', 'awaiting_representative_pickup', 'with_representative', 'delivered',
    'on_hold', 'rework_required', 'cancelled'];
  const today = cairoToday();
  const counts = Object.fromEntries(statuses.map((s) => [s, CASES.filter((c) => c.current_status === s).length]));
  const delivered = CASES.filter((c) => c.current_status === 'delivered');
  const chargeOf = (id: string) => CASE_CHARGES.find((x) => x.case_id === id);
  return {
    ...counts,
    total: CASES.length,
    overdue: CASES.filter((c) => c.due_date && c.due_date < today && !['delivered', 'cancelled'].includes(c.current_status)).length,
    active_employees: PROFILES.filter((p) => p.status === 'active').length,
    total_outstanding: round2(balances().reduce((s, b) => s + b.balance, 0)),
    unpriced_delivered_count: delivered.filter((c) => c.dentist_id && chargeOf(c.id) && chargeOf(c.id)!.net_amount === null).length,
    delivered_without_dentist_count: delivered.filter((c) => !c.dentist_id && chargeOf(c.id)).length,
  };
}

/** Money RPCs; undefined when `name` is not one of them. */
export function moneyRpc(name: string, args: Record<string, unknown>, role: AppRole | undefined): { data: unknown; error: DbError | null } | undefined {
  const money = ['get_dentist_balances', 'get_dentist_statement', 'get_case_balance'];
  if (money.includes(name) && !canReadMoney(role)) return { data: null, error: err('err.money.forbidden', 'forbidden') };
  if (name === 'get_owner_dashboard_stats') {
    if (role !== 'owner') return { data: null, error: err('err.auth.owner_only', 'owner only') };
    return { data: dashboardStats(), error: null };
  }
  if (name === 'get_dentist_balances') return { data: balances(), error: null };
  if (name === 'get_dentist_statement') {
    const r = statement(String(args.p_dentist_id), String(args.p_from ?? ''), String(args.p_to ?? ''));
    return 'code' in r ? { data: null, error: r } : { data: r, error: null };
  }
  if (name === 'get_case_balance') {
    const r = caseBalance(String(args.p_case_id));
    return 'code' in r ? { data: null, error: r } : { data: [r], error: null };
  }
  return undefined;
}
