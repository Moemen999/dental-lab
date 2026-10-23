// @vitest-environment node
/**
 * The payment dialog sends an id generated once when it opens. A second insert with
 * the same id (double submit, retry) must fail on the primary key and leave exactly
 * one payment; the app recognises that error (src/lib/payments.ts) as "already saved".
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, seedStaff, attempt, as, USERS } from './harness';
import { isDuplicatePaymentId } from '@/lib/payments';

let db: PGlite;
let dentist = '';
const PAYMENT_ID = '00000000-0000-4000-8000-0000000000aa';

beforeAll(async () => {
  db = await createTestDb();
  await seedStaff(db);
  const r = await db.query<{ id: string }>(`INSERT INTO dentists (name) VALUES ('د. دفعة مكررة') RETURNING id`);
  dentist = r.rows[0].id;
}, 120_000);

describe('payment id sent by the client', () => {
  it('the same id twice gives one payment and a duplicate-key error the app recognises', async () => {
    const insert = () => attempt(db, as.user(USERS.receptionist),
      `INSERT INTO payments (id, dentist_id, amount, method) VALUES ($1, $2, 150, 'cash')`, [PAYMENT_ID, dentist], { keep: true });
    expect((await insert()).error).toBeUndefined();

    let caught: unknown;
    try {
      await db.transaction(async (tx) => {
        await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: USERS.receptionist, role: 'authenticated' })]);
        await tx.exec('SET LOCAL ROLE authenticated');
        await tx.query(`INSERT INTO payments (id, dentist_id, amount, method) VALUES ($1, $2, 150, 'cash')`, [PAYMENT_ID, dentist]);
      });
    } catch (e) {
      caught = e;
    }
    expect((caught as { code?: string }).code).toBe('23505');
    expect(isDuplicatePaymentId(caught)).toBe(true);

    const n = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM payments WHERE id = $1`, [PAYMENT_ID]);
    expect(n.rows[0].n).toBe(1);
  });

  it('other unique errors are not mistaken for a duplicate payment', () => {
    expect(isDuplicatePaymentId({ code: '23505', message: 'duplicate key value violates unique constraint "payments_one_reversal"' })).toBe(false);
    expect(isDuplicatePaymentId({ code: '42501', message: 'payments_pkey' })).toBe(false);
    expect(isDuplicatePaymentId(null)).toBe(false);
  });
});
