// @vitest-environment node
/**
 * Pricing, discounts, payments and doctor statements (migration 015_pricing.sql).
 * Money is visible only to active owners and receptionists; technicians,
 * representatives, inactive users and anon see nothing.
 * Prove the tests fail before the migration:
 *   DB_MIGRATIONS_EXCLUDE=015 npx vitest run src/test/db/pricing.test.ts
 * All names and amounts are fake.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  createTestDb, seedStaff, seedWorkType, appCaseJaw, attempt, attemptTx, as, USERS, type Caller, type AttemptResult,
} from './harness';

let db: PGlite;
let jaw = { col: '', val: '' };

const PRICED = 'جهاز تجريبي مسعّر';
const LATER = 'مثبت تجريبي يتسعّر لاحقًا';
const UNPRICED = 'نوع تجريبي بدون سعر';
const OLD_TYPE = 'نوع تجريبي موقوف';

const ids = {
  priced: '' as string,
  later: '' as string,
  unpriced: '' as string,
  oldType: '' as string,
  drA: '' as string, // 10% discount
  drB: '' as string, // no discount
  drC: '' as string, // statement doctor, 20% discount
};

const INACTIVE_OWNER = '00000000-0000-4000-8000-0000000000b1';
const INACTIVE_RECEP = '00000000-0000-4000-8000-0000000000b2';

const owner = () => as.user(USERS.owner);
const recep = () => as.user(USERS.receptionist);

const NO_MONEY: Array<[string, () => Caller]> = [
  ['technician', () => as.user(USERS.techA)],
  ['representative', () => as.user(USERS.rep)],
  ['inactive owner', () => as.user(INACTIVE_OWNER)],
  ['inactive receptionist', () => as.user(INACTIVE_RECEP)],
];

/** The query ran (the table/function exists) but RLS returned no rows. */
function expectHidden(r: AttemptResult<unknown>) {
  expect(r.error).toBeUndefined();
  expect(r.rows.length).toBe(0);
}

/** Refused by a permission/rule, not because the table or function is missing. */
function expectRefused(r: AttemptResult<unknown>) {
  expect(r.ok).toBe(false);
  expect(r.error).not.toMatch(/does not exist/);
}

async function addInactive(id: string, role: string) {
  await db.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
     VALUES ($1, $2, '{"full_name": "Fake Inactive"}', now())`,
    [id, `${id.slice(-2)}@example.test`],
  );
  await db.query(`UPDATE profiles SET role = $2::app_role, status = 'inactive' WHERE id = $1`, [id, role]);
}

async function addDentist(name: string): Promise<string> {
  const r = await db.query<{ id: string }>(`INSERT INTO dentists (name) VALUES ($1) RETURNING id`, [name]);
  return r.rows[0].id;
}

/** Registers a case from the app as the receptionist (client path, triggers apply). Kept. */
async function registerCase(caseType: string, dentistId: string | null, patient = 'مريض تجريبي'): Promise<string> {
  const r = await attempt<{ id: string }>(db, recep(),
    `INSERT INTO cases (patient_name, case_type, dentist_id${jaw.col}) VALUES ($1, $2, $3${jaw.val}) RETURNING id`,
    [patient, caseType, dentistId], { keep: true });
  expect(r.error).toBeUndefined();
  return r.rows[0].id;
}

/** Trusted seed (SQL editor path) for a case in any status with a fixed delivery time. */
async function seedMoneyCase(f: { type: string; dentist: string | null; status: string; deliveredAt?: string | null; patient?: string }) {
  const r = await db.query<{ id: string }>(
    `INSERT INTO cases (patient_name, case_type, dentist_id, current_status, delivered_at)
     VALUES ($1, $2, $3, $4::case_status, $5::timestamptz) RETURNING id`,
    [f.patient ?? 'مريض كشف', f.type, f.dentist, f.status, f.deliveredAt ?? null],
  );
  return r.rows[0].id;
}

async function seedPayment(f: { dentist: string; amount: string; at: string; caseId?: string | null; reverses?: string | null }) {
  const r = await db.query<{ id: string }>(
    `INSERT INTO payments (dentist_id, case_id, amount, method, received_at, reverses_payment_id)
     VALUES ($1, $2, $3::numeric, 'cash', $4::timestamptz, $5) RETURNING id`,
    [f.dentist, f.caseId ?? null, f.amount, f.at, f.reverses ?? null],
  );
  return r.rows[0].id;
}

async function charge(caseId: string) {
  const r = await db.query<{ list_price: string | null; discount_percent: string; net_amount: string | null; price_source: string; updated_by: string | null }>(
    `SELECT list_price, discount_percent, net_amount, price_source, updated_by FROM case_charges WHERE case_id = $1`, [caseId]);
  return r.rows[0];
}

beforeAll(async () => {
  db = await createTestDb();
  await seedStaff(db);
  await addInactive(INACTIVE_OWNER, 'owner');
  await addInactive(INACTIVE_RECEP, 'receptionist');
  jaw = await appCaseJaw(db);
  ids.priced = (await seedWorkType(db, PRICED))!;
  ids.later = (await seedWorkType(db, LATER))!;
  ids.unpriced = (await seedWorkType(db, UNPRICED))!;
  ids.oldType = (await seedWorkType(db, OLD_TYPE, false))!;
  ids.drA = await addDentist('د. تجريبي أ');
  ids.drB = await addDentist('د. تجريبي ب');
  ids.drC = await addDentist('د. كشف حساب');
}, 120_000);

// -----------------------------------------------------------------------------
describe('price list (owner writes, owner + receptionist read)', () => {
  it('the owner sets prices; updated_by is the owner and the change is audited', async () => {
    for (const [wt, price] of [[ids.priced, '1000'], [ids.oldType, '700']]) {
      const r = await attempt<{ updated_by: string; price: string }>(db, owner(),
        `INSERT INTO price_list (work_type_id, price, updated_by) VALUES ($1, $2::numeric, $3) RETURNING updated_by, price`,
        [wt, price, USERS.receptionist], { keep: true });
      expect(r.error).toBeUndefined();
      expect(r.rows[0].updated_by).toBe(USERS.owner); // client value ignored
      expect(Number(r.rows[0].price)).toBe(Number(price));
    }
    const a = await db.query(`SELECT 1 FROM audit_logs WHERE action = 'settings_changed' AND target_type = 'price' AND target_id = $1`, [ids.priced]);
    expect(a.rows.length).toBe(1);
  });

  it('the owner can change a price (upsert style)', async () => {
    const r = await attempt<{ price: string }>(db, owner(),
      `INSERT INTO price_list (work_type_id, price) VALUES ($1, 1200)
       ON CONFLICT (work_type_id) DO UPDATE SET work_type_id = EXCLUDED.work_type_id, price = EXCLUDED.price
       RETURNING price`, [ids.priced], { keep: true });
    expect(r.error).toBeUndefined();
    expect(Number(r.rows[0].price)).toBe(1200);
  });

  it('rejects a negative price', async () => {
    const r = await attempt(db, owner(), `INSERT INTO price_list (work_type_id, price) VALUES ($1, -1)`, [ids.unpriced]);
    expectRefused(r);
    expect(r.hint).toBe('err.price.invalid_amount');
  });

  it('owner and receptionist can read prices', async () => {
    for (const c of [owner(), recep()]) {
      const r = await attempt(db, c, `SELECT * FROM price_list`);
      expect(r.error).toBeUndefined();
      expect(r.rows.length).toBe(2);
    }
  });

  it.each(NO_MONEY)('a %s sees no prices', async (_n, c) => {
    const r = await attempt(db, c(), `SELECT * FROM price_list`);
    expectHidden(r);
  });

  it('anon cannot read prices', async () => {
    const r = await attempt(db, as.anon, `SELECT * FROM price_list`);
    expectRefused(r);
    expect(r.error).toMatch(/permission denied/i);
  });

  it.each([['receptionist', recep], ...NO_MONEY])('a %s cannot add or change prices', async (_n, c) => {
    const ins = await attempt(db, c(), `INSERT INTO price_list (work_type_id, price) VALUES ($1, 5)`, [ids.unpriced]);
    expectRefused(ins);
    const upd = await attempt(db, c(), `UPDATE price_list SET price = 1 WHERE work_type_id = $1 RETURNING price`, [ids.priced]);
    expectHidden(upd);
  });

  it('nobody deletes a price row from the app (not even the owner)', async () => {
    const r = await attempt(db, owner(), `DELETE FROM price_list WHERE work_type_id = $1 RETURNING work_type_id`, [ids.priced]);
    expectRefused(r);
  });
});

// -----------------------------------------------------------------------------
describe('doctor discounts (owner writes, owner + receptionist read)', () => {
  it('the owner sets a discount; audited', async () => {
    for (const [d, pct] of [[ids.drA, '10'], [ids.drC, '20']]) {
      const r = await attempt(db, owner(),
        `INSERT INTO dentist_discounts (dentist_id, discount_percent) VALUES ($1, $2::numeric) RETURNING updated_by`,
        [d, pct], { keep: true });
      expect(r.error).toBeUndefined();
    }
    const a = await db.query(`SELECT 1 FROM audit_logs WHERE action = 'settings_changed' AND target_type = 'dentist_discount' AND target_id = $1`, [ids.drA]);
    expect(a.rows.length).toBe(1);
  });

  it.each([['-1'], ['100.01'], ['150']])('rejects discount %s%%', async (pct) => {
    const r = await attempt(db, owner(), `INSERT INTO dentist_discounts (dentist_id, discount_percent) VALUES ($1, $2::numeric)`, [ids.drB, pct]);
    expectRefused(r);
    expect(r.hint).toBe('err.discount.invalid_percent');
  });

  it('receptionist reads discounts', async () => {
    const r = await attempt(db, recep(), `SELECT * FROM dentist_discounts`);
    expect(r.rows.length).toBe(2);
  });

  it.each(NO_MONEY)('a %s sees no discounts', async (_n, c) => {
    expectHidden((await attempt(db, c(), `SELECT * FROM dentist_discounts`)));
  });

  it('anon cannot read discounts', async () => {
    expectRefused((await attempt(db, as.anon, `SELECT * FROM dentist_discounts`)));
  });

  it.each([['receptionist', recep], ...NO_MONEY])('a %s cannot add or change discounts', async (_n, c) => {
    expectRefused((await attempt(db, c(), `INSERT INTO dentist_discounts (dentist_id, discount_percent) VALUES ($1, 5)`, [ids.drB])));
    const upd = await attempt(db, c(), `UPDATE dentist_discounts SET discount_percent = 50 WHERE dentist_id = $1 RETURNING dentist_id`, [ids.drA]);
    expectHidden(upd);
  });
});

// -----------------------------------------------------------------------------
describe('case charge snapshot (trigger on case insert)', () => {
  let cA = '';
  let cB = '';
  let cUnpriced = '';

  beforeAll(async () => {
    cA = await registerCase(PRICED, ids.drA);
    cB = await registerCase(PRICED, ids.drB);
    cUnpriced = await registerCase(UNPRICED, ids.drA);
  });

  it('snapshots the list price and the doctor discount', async () => {
    const a = await charge(cA);
    expect(Number(a.list_price)).toBe(1200);
    expect(Number(a.discount_percent)).toBe(10);
    expect(Number(a.net_amount)).toBe(1080);
    expect(a.price_source).toBe('list');
    const b = await charge(cB);
    expect(Number(b.discount_percent)).toBe(0);
    expect(Number(b.net_amount)).toBe(1200);
  });

  it('a work type without a price gives an unpriced charge (NULL)', async () => {
    const u = await charge(cUnpriced);
    expect(u.list_price).toBeNull();
    expect(u.net_amount).toBeNull();
  });

  it('matches the work type by name ignoring case/spaces, inactive types included', async () => {
    const id = await seedMoneyCase({ type: `  ${OLD_TYPE} `, dentist: ids.drB, status: 'registered' });
    expect(Number((await charge(id)).list_price)).toBe(700);
  });

  it('later price or discount changes do not change existing priced charges', async () => {
    await attempt(db, owner(), `UPDATE price_list SET price = 1500 WHERE work_type_id = $1`, [ids.priced], { keep: true });
    await attempt(db, owner(), `UPDATE dentist_discounts SET discount_percent = 30 WHERE dentist_id = $1`, [ids.drA], { keep: true });
    const a = await charge(cA);
    expect(Number(a.list_price)).toBe(1200);
    expect(Number(a.discount_percent)).toBe(10);
    // restore for the rest of the file
    await attempt(db, owner(), `UPDATE price_list SET price = 1200 WHERE work_type_id = $1`, [ids.priced], { keep: true });
    await attempt(db, owner(), `UPDATE dentist_discounts SET discount_percent = 10 WHERE dentist_id = $1`, [ids.drA], { keep: true });
  });

  it('setting a price for an unpriced work type fills its unpriced, non-cancelled cases', async () => {
    const open = await registerCase(LATER, ids.drA);
    const cancelled = await seedMoneyCase({ type: LATER, dentist: ids.drA, status: 'cancelled' });
    const r = await attempt(db, owner(), `INSERT INTO price_list (work_type_id, price) VALUES ($1, 500)`, [ids.later], { keep: true });
    expect(r.error).toBeUndefined();
    const o = await charge(open);
    expect(Number(o.list_price)).toBe(500);
    expect(Number(o.net_amount)).toBe(450); // keeps its own 10% snapshot
    expect(o.price_source).toBe('list');
    expect((await charge(cancelled)).list_price).toBeNull();
  });

  it('changing the work type before delivery re-prices a list-priced charge', async () => {
    const id = await registerCase(UNPRICED, ids.drB);
    const r = await attempt(db, recep(), `UPDATE cases SET case_type = $2 WHERE id = $1`, [id, PRICED], { keep: true });
    expect(r.error).toBeUndefined();
    expect(Number((await charge(id)).list_price)).toBe(1200);
  });

  it('rounds the net amount to 2 decimals', async () => {
    const r = await attempt<{ net_amount: string }>(db, owner(),
      `UPDATE case_charges SET list_price = 333.33, discount_percent = 15 WHERE case_id = $1 RETURNING net_amount`, [cB]);
    expect(r.error).toBeUndefined();
    expect(r.rows[0].net_amount).toBe('283.33');
  });
});

// -----------------------------------------------------------------------------
describe('case charges: who may read and edit', () => {
  let cid = '';
  beforeAll(async () => {
    cid = await registerCase(PRICED, ids.drB, 'مريض تعديل سعر');
  });

  it('the owner edits a case price: source becomes manual, audited', async () => {
    const r = await attempt<{ price_source: string; net_amount: string; updated_by: string }>(db, owner(),
      `UPDATE case_charges SET list_price = 900, discount_percent = 5 WHERE case_id = $1
       RETURNING price_source, net_amount, updated_by`, [cid], { keep: true });
    expect(r.error).toBeUndefined();
    expect(r.rows[0].price_source).toBe('manual');
    expect(r.rows[0].net_amount).toBe('855.00');
    expect(r.rows[0].updated_by).toBe(USERS.owner);
    const a = await db.query(`SELECT details FROM audit_logs WHERE target_type = 'case_price' AND target_id = $1`, [cid]);
    expect(a.rows.length).toBe(1);
  });

  it('a manual price is kept when the work type changes', async () => {
    await attempt(db, owner(), `UPDATE cases SET case_type = $2 WHERE id = $1`, [cid, UNPRICED], { keep: true });
    expect(Number((await charge(cid)).list_price)).toBe(900);
  });

  it('the price source cannot be set directly from the app', async () => {
    const r = await attempt(db, owner(), `UPDATE case_charges SET price_source = 'list' WHERE case_id = $1`, [cid]);
    expectRefused(r);
    expect(r.error).toMatch(/permission denied/i);
  });

  it('the owner cannot move a charge to another case, insert or delete charges', async () => {
    const other = await registerCase(PRICED, ids.drB);
    expectRefused((await attempt(db, owner(), `UPDATE case_charges SET case_id = $2 WHERE case_id = $1`, [cid, other])));
    expectRefused((await attempt(db, owner(), `INSERT INTO case_charges (case_id, list_price) VALUES ($1, 1)`, [other])));
    const del = await attempt(db, owner(), `DELETE FROM case_charges WHERE case_id = $1 RETURNING case_id`, [cid]);
    expectRefused(del);
  });

  it('receptionist reads but cannot edit', async () => {
    expect((await attempt(db, recep(), `SELECT * FROM case_charges WHERE case_id = $1`, [cid])).rows.length).toBe(1);
    const r = await attempt(db, recep(), `UPDATE case_charges SET list_price = 1 WHERE case_id = $1 RETURNING case_id`, [cid]);
    expectHidden(r);
  });

  it.each(NO_MONEY)('a %s sees and edits no charges', async (_n, c) => {
    expectHidden((await attempt(db, c(), `SELECT * FROM case_charges`)));
    expectHidden((await attempt(db, c(), `UPDATE case_charges SET list_price = 1 RETURNING case_id`)));
  });

  it('a technician sees no charge even for an assigned case', async () => {
    const r0 = await db.query<{ id: string }>(
      `INSERT INTO cases (patient_name, case_type, dentist_id, current_status, assigned_technician_id)
       VALUES ('مريض فني', $1, $2, 'assigned', $3) RETURNING id`, [PRICED, ids.drB, USERS.techA]);
    const id = r0.rows[0].id;
    expect((await attempt(db, as.user(USERS.techA), `SELECT id FROM cases WHERE id = $1`, [id])).rows.length).toBe(1);
    const r = await attempt(db, as.user(USERS.techA), `SELECT * FROM case_charges WHERE case_id = $1`, [id]);
    expectHidden(r);
  });

  it('anon cannot read charges', async () => {
    expectRefused((await attempt(db, as.anon, `SELECT * FROM case_charges`)));
  });
});

// -----------------------------------------------------------------------------
describe('payments: recording, append-only, reversals', () => {
  let caseA = '';
  let caseB = '';
  let payId = '';

  beforeAll(async () => {
    caseA = await registerCase(PRICED, ids.drA, 'مريض دفعة');
    caseB = await registerCase(PRICED, ids.drB, 'مريض طبيب آخر');
  });

  it('receptionist records a payment; received_by/received_at are set by the database; audited', async () => {
    const r = await attempt<{ id: string; received_by: string; received_at: Date }>(db, recep(),
      `INSERT INTO payments (dentist_id, case_id, amount, method, received_by, received_at, note)
       VALUES ($1, $2, 300, 'cash', $3, '2020-01-01', 'دفعة تجريبية') RETURNING id, received_by, received_at`,
      [ids.drA, caseA, USERS.owner], { keep: true });
    expect(r.error).toBeUndefined();
    expect(r.rows[0].received_by).toBe(USERS.receptionist);
    expect(new Date(r.rows[0].received_at).getFullYear()).toBeGreaterThan(2020);
    payId = r.rows[0].id;
    const a = await db.query(`SELECT details FROM audit_logs WHERE target_type = 'payment' AND target_id = $1`, [payId]);
    expect(a.rows.length).toBe(1);
  });

  it('owner records a monthly payment without a case', async () => {
    const r = await attempt(db, owner(), `INSERT INTO payments (dentist_id, amount, method) VALUES ($1, 1000, 'transfer') RETURNING id`, [ids.drA]);
    expect(r.error).toBeUndefined();
  });

  it.each(NO_MONEY)('a %s cannot record or read payments', async (_n, c) => {
    expectRefused((await attempt(db, c(), `INSERT INTO payments (dentist_id, amount) VALUES ($1, 10)`, [ids.drA])));
    expectHidden((await attempt(db, c(), `SELECT * FROM payments`)));
  });

  it('anon cannot record or read payments', async () => {
    expectRefused((await attempt(db, as.anon, `INSERT INTO payments (dentist_id, amount) VALUES ($1, 10)`, [ids.drA])));
    expectRefused((await attempt(db, as.anon, `SELECT * FROM payments`)));
  });

  it.each([['0'], ['-50']])('rejects amount %s on a normal payment', async (amt) => {
    const r = await attempt(db, recep(), `INSERT INTO payments (dentist_id, amount) VALUES ($1, $2::numeric)`, [ids.drA, amt]);
    expectRefused(r);
    expect(r.hint).toBe('err.payment.invalid_amount');
  });

  it('rejects an unknown payment method', async () => {
    const r = await attempt(db, recep(), `INSERT INTO payments (dentist_id, amount, method) VALUES ($1, 10, 'cheque')`, [ids.drA]);
    expect(r.hint).toBe('err.payment.invalid_method');
  });

  it('rejects a case that belongs to another doctor', async () => {
    const r = await attempt(db, recep(), `INSERT INTO payments (dentist_id, case_id, amount) VALUES ($1, $2, 10)`, [ids.drA, caseB]);
    expectRefused(r);
    expect(r.hint).toBe('err.payment.case_dentist_mismatch');
  });

  it('payments are append-only: UPDATE and DELETE are denied, even for the owner', async () => {
    for (const c of [owner(), recep()]) {
      const u = await attempt(db, c, `UPDATE payments SET amount = 1 WHERE id = $1`, [payId]);
      expectRefused(u);
      expect(u.error).toMatch(/permission denied/i);
      const d = await attempt(db, c, `DELETE FROM payments WHERE id = $1`, [payId]);
      expectRefused(d);
      expect(d.error).toMatch(/permission denied/i);
    }
  });

  it('a reversal must be exactly minus the original amount', async () => {
    for (const amt of ['-100', '300', '-300.01']) {
      const r = await attempt(db, recep(),
        `INSERT INTO payments (dentist_id, amount, reverses_payment_id) VALUES ($1, $2::numeric, $3)`, [ids.drA, amt, payId]);
      expect(r.hint).toBe('err.payment.reversal_amount');
    }
  });

  it('a correct reversal copies doctor and case from the original; audited', async () => {
    const r = await attempt<{ id: string; dentist_id: string; case_id: string }>(db, owner(),
      `INSERT INTO payments (dentist_id, amount, reverses_payment_id, note) VALUES ($1, -300, $2, 'تصحيح')
       RETURNING id, dentist_id, case_id`, [ids.drB, payId], { keep: true });
    expect(r.error).toBeUndefined();
    expect(r.rows[0].dentist_id).toBe(ids.drA);
    expect(r.rows[0].case_id).toBe(caseA);
    const a = await db.query(`SELECT details->>'op' AS op FROM audit_logs WHERE target_type = 'payment' AND target_id = $1`, [r.rows[0].id]);
    expect(a.rows[0]).toEqual({ op: 'payment_reversed' });
  });

  it('a payment can be reversed only once', async () => {
    const r = await attempt(db, owner(), `INSERT INTO payments (dentist_id, amount, reverses_payment_id) VALUES ($1, -300, $2)`, [ids.drA, payId]);
    expect(r.hint).toBe('err.payment.already_reversed');
  });

  it('a reversal cannot itself be reversed; unknown originals are rejected', async () => {
    const rev = await db.query<{ id: string }>(`SELECT id FROM payments WHERE reverses_payment_id = $1`, [payId]);
    const r = await attempt(db, owner(), `INSERT INTO payments (dentist_id, amount, reverses_payment_id) VALUES ($1, 300, $2)`, [ids.drA, rev.rows[0].id]);
    expect(r.hint).toBe('err.payment.cannot_reverse_reversal');
    const u = await attempt(db, owner(), `INSERT INTO payments (dentist_id, amount, reverses_payment_id) VALUES ($1, -1, gen_random_uuid())`, [ids.drA]);
    expect(u.hint).toBe('err.payment.not_found');
  });

  it("a case's doctor cannot change once it has payments", async () => {
    const r = await attempt(db, recep(), `UPDATE cases SET dentist_id = $2 WHERE id = $1`, [caseA, ids.drB]);
    expectRefused(r);
    expect(r.hint).toBe('err.case.has_payments');
  });
});

// -----------------------------------------------------------------------------
describe('statement, balances and case balance', () => {
  const s: Record<string, string> = {};

  beforeAll(async () => {
    // Doctor C: 20% discount, PRICED = 1200 -> net 960.
    s.jan15 = await seedMoneyCase({ type: PRICED, dentist: ids.drC, status: 'delivered', deliveredAt: '2026-01-15T10:00:00Z', patient: 'مريض يناير' });
    // 21:30 UTC = 23:30 Cairo (UTC+2 in winter): still January 31.
    s.jan31 = await seedMoneyCase({ type: PRICED, dentist: ids.drC, status: 'delivered', deliveredAt: '2026-01-31T21:30:00Z' });
    // 22:30 UTC = 00:30 Cairo on February 1.
    s.feb1 = await seedMoneyCase({ type: PRICED, dentist: ids.drC, status: 'delivered', deliveredAt: '2026-01-31T22:30:00Z' });
    s.febUnpriced = await seedMoneyCase({ type: UNPRICED, dentist: ids.drC, status: 'delivered', deliveredAt: '2026-02-10T10:00:00Z' });
    s.inProgress = await seedMoneyCase({ type: PRICED, dentist: ids.drC, status: 'in_progress' });
    s.cancelled = await seedMoneyCase({ type: PRICED, dentist: ids.drC, status: 'cancelled' });
    s.march = await seedMoneyCase({ type: PRICED, dentist: ids.drC, status: 'delivered', deliveredAt: '2026-03-03T10:00:00Z' });

    s.p1 = await seedPayment({ dentist: ids.drC, amount: '500', at: '2026-01-20T12:00:00Z', caseId: s.jan15 });
    s.p2 = await seedPayment({ dentist: ids.drC, amount: '300', at: '2026-01-31T22:15:00Z' }); // Feb 1 00:15 Cairo
    s.p3 = await seedPayment({ dentist: ids.drC, amount: '100', at: '2026-02-05T10:00:00Z', caseId: s.feb1 });
    s.r3 = await seedPayment({ dentist: ids.drC, amount: '-100', at: '2026-02-06T10:00:00Z', caseId: s.feb1, reverses: s.p3 });
    s.p4 = await seedPayment({ dentist: ids.drC, amount: '50', at: '2026-03-01T10:00:00Z' });
  });

  type Line = { kind: string; case_id: string | null; payment_id: string | null; debit: number | null; credit: number | null;
    balance: number; priced: boolean; date: string; case_number: string | null; patient_name: string | null; work_type: string | null };
  type Statement = { opening_balance: number; closing_balance: number; total_debit: number; total_credit: number;
    unpriced_count: number; lines: Line[]; dentist: { id: string; name: string } };

  async function statement(caller: Caller, from: string, to: string, dentist = ids.drC) {
    return attempt<{ s: Statement }>(db, caller, `SELECT public.get_dentist_statement($1, $2::date, $3::date) AS s`, [dentist, from, to]);
  }

  it('January: opening 0, two charges and one payment, closing 1420', async () => {
    const r = await statement(owner(), '2026-01-01', '2026-01-31');
    expect(r.error).toBeUndefined();
    const st = r.rows[0].s;
    expect(st.dentist.name).toBe('د. كشف حساب');
    expect(st.opening_balance).toBe(0);
    expect(st.lines.map((l) => [l.kind, l.debit, l.credit, l.balance])).toEqual([
      ['charge', 960, null, 960],
      ['payment', null, 500, 460],
      ['charge', 960, null, 1420],
    ]);
    expect(st.lines[0]).toMatchObject({ case_id: s.jan15, patient_name: 'مريض يناير', work_type: PRICED, date: '2026-01-15' });
    expect(st.lines[0].case_number).toMatch(/^CASE-/);
    expect(st.closing_balance).toBe(1420);
  });

  it('February: opening carries January; Cairo midnight boundary; reversal; unpriced line not counted', async () => {
    const r = await statement(recep(), '2026-02-01', '2026-02-28');
    expect(r.error).toBeUndefined();
    const st = r.rows[0].s;
    expect(st.opening_balance).toBe(1420);
    expect(st.lines.map((l) => [l.kind, l.debit, l.credit, l.balance, l.priced])).toEqual([
      ['payment', null, 300, 1120, true], // 2026-01-31 22:15 UTC = Feb 1 Cairo
      ['charge', 960, null, 2080, true], // 2026-01-31 22:30 UTC = Feb 1 Cairo
      ['payment', null, 100, 1980, true],
      ['reversal', 100, null, 2080, true],
      ['charge', null, null, 2080, false], // delivered but not priced
    ]);
    expect(st.lines[0].date).toBe('2026-02-01');
    expect(st.total_debit).toBe(1060);
    expect(st.total_credit).toBe(400);
    expect(st.closing_balance).toBe(2080);
    expect(st.unpriced_count).toBe(1);
    // in-progress and cancelled cases never appear
    const caseIds = st.lines.map((l) => l.case_id);
    expect(caseIds).not.toContain(s.inProgress);
    expect(caseIds).not.toContain(s.cancelled);
  });

  it('a whole-year statement closes at the same balance as get_dentist_balances', async () => {
    const st = (await statement(owner(), '2026-01-01', '2026-12-31')).rows[0].s;
    expect(st.closing_balance).toBe(3840 - 850);
    const b = await attempt<{ total_due: string; total_paid: string; balance: string; unpriced_delivered_count: number }>(db, recep(),
      `SELECT * FROM public.get_dentist_balances() WHERE dentist_id = $1`, [ids.drC]);
    expect(b.error).toBeUndefined();
    expect(Number(b.rows[0].total_due)).toBe(3840); // 4 delivered priced cases x 960
    expect(Number(b.rows[0].total_paid)).toBe(850); // 500 + 300 + 100 - 100 + 50
    expect(Number(b.rows[0].balance)).toBe(2990);
    expect(Number(b.rows[0].unpriced_delivered_count)).toBe(1);
  });

  it('balances list every doctor (zero when nothing is due)', async () => {
    const r = await attempt<{ dentist_id: string; balance: string }>(db, owner(), `SELECT * FROM public.get_dentist_balances()`);
    expect(r.rows.map((x) => x.dentist_id)).toEqual(expect.arrayContaining([ids.drA, ids.drB, ids.drC]));
  });

  it('case balance: net, paid against the case (reversals included), remaining', async () => {
    const r = await attempt<{ net_amount: string; paid: string; remaining: string; is_due: boolean; is_priced: boolean }>(db, recep(),
      `SELECT * FROM public.get_case_balance($1)`, [s.jan15]);
    expect(r.error).toBeUndefined();
    expect(r.rows[0]).toMatchObject({ is_due: true, is_priced: true });
    expect(Number(r.rows[0].net_amount)).toBe(960);
    expect(Number(r.rows[0].paid)).toBe(500);
    expect(Number(r.rows[0].remaining)).toBe(460);
    const f = await attempt<{ paid: string; remaining: string }>(db, owner(), `SELECT * FROM public.get_case_balance($1)`, [s.feb1]);
    expect(Number(f.rows[0].paid)).toBe(0);
    expect(Number(f.rows[0].remaining)).toBe(960);
    const p = await attempt<{ is_due: boolean }>(db, owner(), `SELECT * FROM public.get_case_balance($1)`, [s.inProgress]);
    expect(p.rows[0].is_due).toBe(false);
  });

  it('rejects an invalid period and an unknown doctor', async () => {
    expect((await statement(owner(), '2026-02-10', '2026-02-01')).hint).toBe('err.statement.invalid_period');
    const u = await attempt(db, owner(), `SELECT public.get_dentist_statement(gen_random_uuid(), '2026-01-01', '2026-01-31')`);
    expect(u.hint).toBe('err.dentist.not_found');
    const c = await attempt(db, owner(), `SELECT * FROM public.get_case_balance(gen_random_uuid())`);
    expect(c.hint).toBe('err.case.not_found');
  });

  it.each(NO_MONEY)('a %s cannot call the money functions', async (_n, c) => {
    const calls = [
      [`SELECT public.get_dentist_statement($1, '2026-01-01', '2026-01-31')`, [ids.drC]],
      [`SELECT * FROM public.get_dentist_balances()`, []],
      [`SELECT * FROM public.get_case_balance($1)`, [s.jan15]],
    ] as const;
    for (const [sql, params] of calls) {
      const r = await attempt(db, c(), sql, [...params]);
      expectRefused(r);
      expect(r.hint).toBe('err.money.forbidden');
    }
  });

  it('anon cannot execute the money functions', async () => {
    const r = await attempt(db, as.anon, `SELECT * FROM public.get_dentist_balances()`);
    expectRefused(r);
    expect(r.error).toMatch(/permission denied/i);
  });
});

// -----------------------------------------------------------------------------
describe('owner dashboard stats (KNOWN_ISSUES #16: one RPC instead of 17 counts)', () => {
  type Stats = Record<string, number>;

  it('returns the same counts as the old per-status queries, plus total outstanding', async () => {
    const r = await attempt<{ s: Stats }>(db, owner(), `SELECT public.get_owner_dashboard_stats() AS s`);
    expect(r.error).toBeUndefined();
    const st = r.rows[0].s;

    const statuses = await db.query<{ s: string; n: number }>(
      `SELECT e::text AS s, (SELECT count(*) FROM cases c WHERE c.current_status = e)::int AS n
         FROM unnest(enum_range(NULL::case_status)) e`);
    for (const row of statuses.rows) expect(st[row.s]).toBe(row.n);

    const expected = await db.query<{ total: number; overdue: number; active: number; outstanding: string; unpriced: number }>(`
      SELECT (SELECT count(*) FROM cases)::int AS total,
             (SELECT count(*) FROM cases WHERE due_date < (now() AT TIME ZONE 'Africa/Cairo')::date
                AND current_status NOT IN ('delivered', 'cancelled'))::int AS overdue,
             (SELECT count(*) FROM profiles WHERE status = 'active')::int AS active,
             ((SELECT coalesce(sum(cc.net_amount), 0) FROM case_charges cc JOIN cases c ON c.id = cc.case_id
                WHERE c.current_status = 'delivered' AND c.dentist_id IS NOT NULL)
              - (SELECT coalesce(sum(amount), 0) FROM payments))::text AS outstanding,
             (SELECT count(*) FROM case_charges cc JOIN cases c ON c.id = cc.case_id
                WHERE c.current_status = 'delivered' AND c.dentist_id IS NOT NULL AND cc.net_amount IS NULL)::int AS unpriced`);
    const e = expected.rows[0];
    expect(st.total).toBe(e.total);
    expect(st.total).toBeGreaterThan(10);
    expect(st.overdue).toBe(e.overdue);
    expect(st.active_employees).toBe(e.active);
    expect(st.active_employees).toBe(7);
    expect(st.total_outstanding).toBe(Number(e.outstanding));
    expect(st.total_outstanding).toBeGreaterThan(0);
    expect(st.unpriced_delivered_count).toBe(e.unpriced);
  });

  it('counts an overdue case by the Cairo date', async () => {
    const before = (await attempt<{ s: Stats }>(db, owner(), `SELECT public.get_owner_dashboard_stats() AS s`)).rows[0].s.overdue;
    const id = await seedMoneyCase({ type: PRICED, dentist: null, status: 'in_progress' });
    await db.query(`UPDATE cases SET due_date = (now() AT TIME ZONE 'Africa/Cairo')::date - 1 WHERE id = $1`, [id]);
    const after = (await attempt<{ s: Stats }>(db, owner(), `SELECT public.get_owner_dashboard_stats() AS s`)).rows[0].s.overdue;
    expect(after).toBe(before + 1);
  });

  it.each([
    ['receptionist', recep],
    ...NO_MONEY,
  ])('a %s is refused', async (_n, c) => {
    const r = await attempt(db, c(), `SELECT public.get_owner_dashboard_stats()`);
    expectRefused(r);
    expect(r.hint).toBe('err.auth.owner_only');
  });

  it('anon is refused', async () => {
    expectRefused((await attempt(db, as.anon, `SELECT public.get_owner_dashboard_stats()`)));
  });
});

// -----------------------------------------------------------------------------
// Security review of ff4b0fc (B1, S1–S3, N1–N11). Each test failed before its fix
// unless noted.
// -----------------------------------------------------------------------------

/** Runs SQL as the trusted DB owner (SQL editor path) and always rolls back. */
async function trustedTry(sql: string, params: unknown[] = []): Promise<{ ok: boolean; hint?: string; error?: string }> {
  let out: { ok: boolean; hint?: string; error?: string } = { ok: false };
  try {
    await db.transaction(async (tx) => {
      await tx.query(sql, params);
      out = { ok: true };
      await tx.rollback();
    });
  } catch (e) {
    const hint = (e as { hint?: unknown }).hint;
    out = { ok: false, error: e instanceof Error ? e.message : String(e), hint: typeof hint === 'string' ? hint : undefined };
  }
  return out;
}

async function auditFor(target: string, targetType: string) {
  const r = await db.query<{ details: Record<string, unknown> }>(
    `SELECT details FROM audit_logs WHERE target_type = $2 AND target_id = $1 ORDER BY created_at, id`, [target, targetType]);
  return r.rows.map((x) => x.details);
}

describe('review B1: the doctor of a delivered case is locked (owner only, audited)', () => {
  let delivered = '';
  let deliveredManual = '';

  beforeAll(async () => {
    // Dr A has 10 %: PRICED 1200 -> 1080 owed by Dr A.
    delivered = await seedMoneyCase({ type: PRICED, dentist: ids.drA, status: 'delivered', deliveredAt: '2026-04-10T10:00:00Z' });
    deliveredManual = await seedMoneyCase({ type: PRICED, dentist: ids.drA, status: 'delivered', deliveredAt: '2026-04-11T10:00:00Z' });
    await db.query(`UPDATE case_charges SET list_price = 1000, discount_percent = 10, price_source = 'manual' WHERE case_id = $1`, [deliveredManual]);
  });

  it.each([['removing the doctor', null], ['moving to another doctor', 'drB']] as const)(
    'a receptionist is refused %s', async (_n, to) => {
      const r = await attempt(db, recep(), `UPDATE cases SET dentist_id = $2 WHERE id = $1`, [delivered, to ? ids[to] : null]);
      expect(r.ok).toBe(false);
      expect(r.hint).toBe('err.case.delivered_dentist_locked');
    });

  it('the service role is refused too', async () => {
    const r = await attempt(db, as.service, `UPDATE cases SET dentist_id = $2 WHERE id = $1`, [delivered, ids.drB]);
    expect(r.hint).toBe('err.case.delivered_dentist_locked');
  });

  it('the owner may move it: a list charge takes the new doctor discount, audited', async () => {
    const r = await attempt(db, owner(), `UPDATE cases SET dentist_id = $2 WHERE id = $1`, [delivered, ids.drB], { keep: true });
    expect(r.error).toBeUndefined();
    const c = await charge(delivered);
    expect(Number(c.discount_percent)).toBe(0);
    expect(Number(c.net_amount)).toBe(1200);
    expect(c.price_source).toBe('list');
    const a = await auditFor(delivered, 'case_price');
    expect(a.at(-1)).toMatchObject({
      op: 'case_dentist_changed', previous_dentist_id: ids.drA, dentist_id: ids.drB,
      previous_net_amount: 1080, net_amount: 1200,
    });
  });

  it('the owner may move a manually priced one: price kept, audited', async () => {
    const r = await attempt(db, owner(), `UPDATE cases SET dentist_id = NULL WHERE id = $1`, [deliveredManual], { keep: true });
    expect(r.error).toBeUndefined();
    expect(Number((await charge(deliveredManual)).net_amount)).toBe(900);
    const a = await auditFor(deliveredManual, 'case_price');
    expect(a.at(-1)).toMatchObject({ op: 'case_dentist_changed', previous_dentist_id: ids.drA, dentist_id: null });
  });
});

describe('review S1: recording a payment locks the case row', () => {
  // PGlite is a single connection, so the race itself cannot run here. This guards
  // the lock that serializes "change doctor" against "record payment" on Postgres.
  it('validate_payment reads the case with FOR SHARE', async () => {
    const r = await db.query<{ src: string }>(`SELECT prosrc AS src FROM pg_proc WHERE proname = 'validate_payment'`);
    expect(r.rows[0].src).toMatch(/FROM public\.cases c\s+WHERE c\.id = NEW\.case_id\s+FOR SHARE/);
  });
});

describe('review S2: direct edits are manual + audited; the service role cannot write money', () => {
  it('a direct SQL-editor edit of a case price becomes manual and is audited', async () => {
    const id = await registerCase(PRICED, ids.drB, 'مريض تعديل مباشر');
    await db.query(`UPDATE case_charges SET list_price = 777 WHERE case_id = $1`, [id]);
    expect((await charge(id)).price_source).toBe('manual');
    expect((await auditFor(id, 'case_price')).at(-1)).toMatchObject({ op: 'case_price_changed', list_price: 777 });
  });

  it('a work type change still leaves a list charge as list', async () => {
    const id = await registerCase(UNPRICED, ids.drB);
    await attempt(db, recep(), `UPDATE cases SET case_type = $2 WHERE id = $1`, [id, PRICED], { keep: true });
    expect((await charge(id)).price_source).toBe('list');
  });

  it.each([
    ['price_list', `INSERT INTO price_list (work_type_id, price) VALUES ('00000000-0000-4000-8000-00000000ffff', 1)`],
    ['price_list update', `UPDATE price_list SET price = 1`],
    ['dentist_discounts', `UPDATE dentist_discounts SET discount_percent = 1`],
    ['case_charges', `UPDATE case_charges SET list_price = 1`],
    ['payments', `INSERT INTO payments (dentist_id, amount, received_at) SELECT id, 5, '2020-01-01' FROM dentists LIMIT 1`],
  ])('the service role cannot write %s', async (_n, sql) => {
    const r = await attempt(db, as.service, sql);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/permission denied/i);
  });
});

describe('review S3: payments are append-only even for the database owner', () => {
  it.each([
    ['UPDATE', `UPDATE payments SET note = 'x'`],
    ['DELETE', `DELETE FROM payments`],
    ['TRUNCATE', `TRUNCATE payments`],
  ])('%s is refused', async (_n, sql) => {
    const r = await trustedTry(sql);
    expect(r.ok).toBe(false);
    expect(r.hint).toBe('err.payment.append_only');
  });
});

describe('review N1: a case inserted as delivered gets delivered_at', () => {
  it('a trusted insert with status delivered stamps delivered_at', async () => {
    const id = await seedMoneyCase({ type: PRICED, dentist: ids.drB, status: 'delivered', deliveredAt: null });
    const r = await db.query<{ delivered_at: Date | null }>(`SELECT delivered_at FROM cases WHERE id = $1`, [id]);
    expect(r.rows[0].delivered_at).not.toBeNull();
  });
});

describe('review N2/N3/N5/N8/N9/N11', () => {
  let drD = '';
  let open = '';
  let cancelled = '';
  let paidBeforeCancel = '';

  beforeAll(async () => {
    drD = await addDentist('د. مراجعة');
    open = await registerCase(PRICED, drD, 'مريض مفتوح');
    cancelled = await registerCase(PRICED, drD, 'مريض ملغي');
    const p = await attempt<{ id: string }>(db, recep(),
      `INSERT INTO payments (dentist_id, case_id, amount) VALUES ($1, $2, 100) RETURNING id`, [drD, cancelled], { keep: true });
    paidBeforeCancel = p.rows[0].id;
    const c = await attempt(db, recep(), `SELECT public.transition_case_status($1, 'cancelled')`, [cancelled], { keep: true });
    expect(c.error).toBeUndefined();
  });

  it('N2: cases that are not due (open, cancelled) have is_due false and remaining NULL', async () => {
    for (const id of [open, cancelled]) {
      const r = await attempt<{ is_due: boolean; remaining: string | null }>(db, owner(),
        `SELECT * FROM public.get_case_balance($1)`, [id]);
      expect(r.rows[0].is_due).toBe(false);
      expect(r.rows[0].remaining).toBeNull();
    }
  });

  it('N2: a delivered case without a doctor is not due', async () => {
    const id = await seedMoneyCase({ type: PRICED, dentist: null, status: 'delivered', deliveredAt: '2026-05-01T10:00:00Z' });
    const r = await attempt<{ is_due: boolean; remaining: string | null }>(db, owner(), `SELECT * FROM public.get_case_balance($1)`, [id]);
    expect(r.rows[0]).toMatchObject({ is_due: false, remaining: null });
  });

  it('N3: a per-case payment on a cancelled case is refused', async () => {
    const r = await attempt(db, recep(), `INSERT INTO payments (dentist_id, case_id, amount) VALUES ($1, $2, 50)`, [drD, cancelled]);
    expect(r.hint).toBe('err.payment.case_not_billable');
  });

  it('N3: a per-case payment on a case without a charge row is refused', async () => {
    const id = await seedMoneyCase({ type: PRICED, dentist: drD, status: 'registered' });
    await db.query(`DELETE FROM case_charges WHERE case_id = $1`, [id]);
    const r = await attempt(db, recep(), `INSERT INTO payments (dentist_id, case_id, amount) VALUES ($1, $2, 50)`, [drD, id]);
    expect(r.hint).toBe('err.payment.case_not_billable');
  });

  it('N3: a payment on a case that was cancelled later can still be reversed (passed before too)', async () => {
    const r = await attempt(db, owner(), `INSERT INTO payments (amount, reverses_payment_id) VALUES (-100, $1)`, [paidBeforeCancel]);
    expect(r.error).toBeUndefined();
  });

  it('N3: a payment without a case is still allowed (passed before too)', async () => {
    const r = await attempt(db, recep(), `INSERT INTO payments (dentist_id, amount) VALUES ($1, 50)`, [drD]);
    expect(r.error).toBeUndefined();
  });

  it('N5: a work type change that re-prices a case is audited per case', async () => {
    const id = await registerCase(UNPRICED, drD, 'مريض تغيير نوع');
    await attempt(db, recep(), `UPDATE cases SET case_type = $2 WHERE id = $1`, [id, PRICED], { keep: true });
    const a = await auditFor(id, 'case_price');
    expect(a.at(-1)).toMatchObject({ op: 'case_repriced', previous_list_price: null, list_price: 1200 });
  });

  it('N5: the price-list audit lists the cases it priced (delivered ones included)', async () => {
    const name = 'نوع مراجعة بلا سعر';
    const wt = (await seedWorkType(db, name))!;
    const a1 = await registerCase(name, drD);
    const a2 = await seedMoneyCase({ type: name, dentist: drD, status: 'delivered', deliveredAt: '2026-05-02T10:00:00Z' });
    await attempt(db, owner(), `INSERT INTO price_list (work_type_id, price) VALUES ($1, 300)`, [wt], { keep: true });
    const a = (await auditFor(wt, 'price')).at(-1)!;
    expect(a).toMatchObject({ priced_cases_count: 2 });
    expect([...(a.priced_case_ids as string[])].sort()).toEqual([a1, a2].sort());
  });

  it('N8: the dashboard counts delivered (billable) cases without a doctor', async () => {
    const r = await attempt<{ s: Record<string, number> }>(db, owner(), `SELECT public.get_owner_dashboard_stats() AS s`);
    const e = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM cases c JOIN case_charges cc ON cc.case_id = c.id
      WHERE c.current_status = 'delivered' AND c.dentist_id IS NULL`);
    expect(e.rows[0].n).toBeGreaterThan(0);
    expect(r.rows[0].s.delivered_without_dentist_count).toBe(e.rows[0].n);
  });

  it('N9: last_payment_at ignores reversed payments and reversals', async () => {
    const drE = await addDentist('د. آخر دفعة');
    await seedPayment({ dentist: drE, amount: '100', at: '2026-01-10T10:00:00Z' });
    const q = await seedPayment({ dentist: drE, amount: '200', at: '2026-01-20T10:00:00Z' });
    await seedPayment({ dentist: drE, amount: '-200', at: '2026-01-25T10:00:00Z', reverses: q });
    const r = await attempt<{ last_payment_at: Date }>(db, owner(),
      `SELECT last_payment_at FROM public.get_dentist_balances() WHERE dentist_id = $1`, [drE]);
    expect(new Date(r.rows[0].last_payment_at).toISOString()).toBe('2026-01-10T10:00:00.000Z');
  });

  it('N11: two reversals of one payment in one statement give already_reversed', async () => {
    const p = await seedPayment({ dentist: drD, amount: '40', at: '2026-02-01T10:00:00Z' });
    const r = await attempt(db, owner(),
      `INSERT INTO payments (amount, reverses_payment_id) VALUES (-40, $1), (-40, $1)`, [p]);
    expect(r.ok).toBe(false);
    expect(r.hint).toBe('err.payment.already_reversed');
  });

  it('N11: two reversals in one transaction give already_reversed', async () => {
    const p = await seedPayment({ dentist: drD, amount: '30', at: '2026-02-02T10:00:00Z' });
    const r = await attemptTx(db, owner(), async (tx) => {
      await tx.query(`INSERT INTO payments (amount, reverses_payment_id) VALUES (-30, $1)`, [p]);
      try {
        await tx.query(`INSERT INTO payments (amount, reverses_payment_id) VALUES (-30, $1)`, [p]);
        return 'second insert passed';
      } catch (e) {
        return (e as { hint?: string }).hint ?? (e as Error).message;
      }
    });
    expect(r.value).toBe('err.payment.already_reversed');
  });
});

// -----------------------------------------------------------------------------
// Optional opening balance per doctor (owner decision: deliveries before the
// money module are settled per doctor by an opening balance, never by charging
// old cases). Positive = the doctor owes the lab; negative = credit.
// -----------------------------------------------------------------------------
describe('opening balances: who may read and write (audited)', () => {
  let drI = '';
  beforeAll(async () => {
    drI = await addDentist('د. رصيد افتتاحي');
  });

  const insertOb = (c: Caller, amount = '250') => attempt(db, c,
    `INSERT INTO dentist_opening_balances (dentist_id, amount, as_of, note, updated_by)
     VALUES ($1, $2::numeric, '2026-01-01', 'رصيد قديم', $3) RETURNING updated_by`, [drI, amount, USERS.receptionist]);

  it('the owner sets, changes and removes it; every change is audited', async () => {
    const ins = await attempt<{ updated_by: string }>(db, owner(),
      `INSERT INTO dentist_opening_balances (dentist_id, amount, as_of, updated_by) VALUES ($1, 250, '2026-01-01', $2)
       RETURNING updated_by`, [drI, USERS.receptionist], { keep: true });
    expect(ins.error).toBeUndefined();
    expect(ins.rows[0].updated_by).toBe(USERS.owner);
    const upd = await attempt(db, owner(),
      `UPDATE dentist_opening_balances SET amount = -100, as_of = '2026-02-01' WHERE dentist_id = $1 RETURNING dentist_id`,
      [drI], { keep: true });
    expect(upd.rows.length).toBe(1);
    const del = await attempt(db, owner(), `DELETE FROM dentist_opening_balances WHERE dentist_id = $1 RETURNING dentist_id`,
      [drI], { keep: true });
    expect(del.rows.length).toBe(1);
    const a = await auditFor(drI, 'opening_balance');
    expect(a).toMatchObject([
      { op: 'opening_set', amount: 250, as_of: '2026-01-01' },
      { op: 'opening_changed', amount: -100, as_of: '2026-02-01', previous_amount: 250, previous_as_of: '2026-01-01' },
      { op: 'opening_removed', previous_amount: -100, previous_as_of: '2026-02-01' },
    ]);
    // set again for the read tests below
    expect((await insertOb(owner())).error).toBeUndefined();
    await attempt(db, owner(), `INSERT INTO dentist_opening_balances (dentist_id, amount, as_of) VALUES ($1, 250, '2026-01-01')`,
      [drI], { keep: true });
  });

  it('rejects a missing amount or date', async () => {
    const d = await addDentist('د. رصيد ناقص');
    for (const sql of [
      `INSERT INTO dentist_opening_balances (dentist_id, amount, as_of) VALUES ($1, NULL, '2026-01-01')`,
      `INSERT INTO dentist_opening_balances (dentist_id, amount, as_of) VALUES ($1, 10, NULL)`,
    ]) {
      const r = await attempt(db, owner(), sql, [d]);
      expect(r.hint).toBe('err.opening_balance.invalid');
    }
  });

  it('receptionist reads it but cannot write', async () => {
    expect((await attempt(db, recep(), `SELECT * FROM dentist_opening_balances WHERE dentist_id = $1`, [drI])).rows.length).toBe(1);
    const d = await addDentist('د. استقبال');
    expectRefused(await attempt(db, recep(), `INSERT INTO dentist_opening_balances (dentist_id, amount, as_of) VALUES ($1, 5, '2026-01-01')`, [d]));
    expectHidden(await attempt(db, recep(), `UPDATE dentist_opening_balances SET amount = 1 WHERE dentist_id = $1 RETURNING dentist_id`, [drI]));
    expectHidden(await attempt(db, recep(), `DELETE FROM dentist_opening_balances WHERE dentist_id = $1 RETURNING dentist_id`, [drI]));
  });

  it.each(NO_MONEY)('a %s sees and writes nothing', async (_n, c) => {
    expectHidden(await attempt(db, c(), `SELECT * FROM dentist_opening_balances`));
    expectRefused(await insertOb(c()));
    expectHidden(await attempt(db, c(), `UPDATE dentist_opening_balances SET amount = 1 RETURNING dentist_id`));
    expectHidden(await attempt(db, c(), `DELETE FROM dentist_opening_balances RETURNING dentist_id`));
  });

  it('anon and the service role cannot write; anon cannot read', async () => {
    expectRefused(await attempt(db, as.anon, `SELECT * FROM dentist_opening_balances`));
    for (const sql of [
      `UPDATE dentist_opening_balances SET amount = 1`,
      `DELETE FROM dentist_opening_balances`,
      `INSERT INTO dentist_opening_balances (dentist_id, amount, as_of) SELECT id, 1, '2026-01-01' FROM dentists LIMIT 1`,
    ]) {
      const r = await attempt(db, as.service, sql);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/permission denied/i);
    }
  });
});

describe('opening balances in statements, balances and the dashboard', () => {
  let drF = '';
  let drG = '';

  type OLine = { kind: string; debit: number | null; credit: number | null; balance: number; date: string; note: string | null };
  type OStatement = { opening_balance: number; closing_balance: number; total_debit: number; total_credit: number; lines: OLine[] };
  const stmt = async (d: string, from: string, to: string) =>
    (await attempt<{ s: OStatement }>(db, owner(), `SELECT public.get_dentist_statement($1, $2::date, $3::date) AS s`, [d, from, to])).rows[0]?.s;

  beforeAll(async () => {
    drF = await addDentist('د. افتتاحي مدين');
    drG = await addDentist('د. افتتاحي دائن');
    // Doctor F owed 500 before the system, as of 15 March (Cairo date).
    await attempt(db, owner(), `INSERT INTO dentist_opening_balances (dentist_id, amount, as_of, note) VALUES ($1, 500, '2026-03-15', 'قبل النظام')`,
      [drF], { keep: true });
    await seedPayment({ dentist: drF, amount: '50', at: '2026-03-14T21:30:00Z' }); // 14 Mar 23:30 Cairo
    await seedPayment({ dentist: drF, amount: '200', at: '2026-03-14T22:30:00Z' }); // 15 Mar 00:30 Cairo
    // Lab owes doctor G 300 (credit).
    await attempt(db, owner(), `INSERT INTO dentist_opening_balances (dentist_id, amount, as_of) VALUES ($1, -300, '2026-01-01')`,
      [drG], { keep: true });
  });

  it('as_of inside the period: an opening line on that date, before same-day payments', async () => {
    const s = await stmt(drF, '2026-03-15', '2026-03-31');
    expect(s.opening_balance).toBe(-50);
    expect(s.lines.map((l) => [l.kind, l.date, l.debit, l.credit, l.balance])).toEqual([
      ['opening', '2026-03-15', 500, null, 450],
      ['payment', '2026-03-15', null, 200, 250],
    ]);
    expect(s.lines[0].note).toBe('قبل النظام');
    expect(s.total_debit).toBe(500);
    expect(s.closing_balance).toBe(250);
  });

  it('as_of after the period end: ignored', async () => {
    const s = await stmt(drF, '2026-03-01', '2026-03-14');
    expect(s.lines.map((l) => l.kind)).toEqual(['payment']);
    expect(s.closing_balance).toBe(-50);
  });

  it('as_of before the period start: part of the opening balance', async () => {
    const s = await stmt(drF, '2026-04-01', '2026-04-30');
    expect(s.opening_balance).toBe(250);
    expect(s.lines).toEqual([]);
    expect(s.closing_balance).toBe(250);
  });

  it('a negative opening balance is a credit line', async () => {
    const s = await stmt(drG, '2026-01-01', '2026-01-31');
    expect(s.lines.map((l) => [l.kind, l.debit, l.credit, l.balance])).toEqual([['opening', null, 300, -300]]);
    expect(s.closing_balance).toBe(-300);
  });

  it('balances include it', async () => {
    const r = await attempt<{ dentist_id: string; opening_balance: string; balance: string; total_paid: string }>(db, recep(),
      `SELECT * FROM public.get_dentist_balances() WHERE dentist_id IN ($1, $2)`, [drF, drG]);
    const f = r.rows.find((x) => x.dentist_id === drF)!;
    const g = r.rows.find((x) => x.dentist_id === drG)!;
    expect(Number(f.opening_balance)).toBe(500);
    expect(Number(f.total_paid)).toBe(250);
    expect(Number(f.balance)).toBe(250);
    expect(Number(g.opening_balance)).toBe(-300);
    expect(Number(g.balance)).toBe(-300);
  });

  it('the dashboard total outstanding includes it', async () => {
    const get = async () => (await attempt<{ s: Record<string, number> }>(db, owner(),
      `SELECT public.get_owner_dashboard_stats() AS s`)).rows[0].s.total_outstanding;
    const before = await get();
    const d = await addDentist('د. لوحة التحكم');
    await attempt(db, owner(), `INSERT INTO dentist_opening_balances (dentist_id, amount, as_of) VALUES ($1, 1234.5, '2026-01-01')`,
      [d], { keep: true });
    expect(await get()).toBeCloseTo(before + 1234.5, 2);
  });
});
