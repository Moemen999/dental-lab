// @vitest-environment node
/**
 * Migration 016: an opening balance cannot be 0 (delete it instead) and cannot be
 * dated in the future (Cairo date). Prove they fail before the migration:
 *   DB_MIGRATIONS_EXCLUDE=016 npx vitest run src/test/db/openingBalanceRules.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, seedStaff, attempt, as, USERS } from './harness';

let db: PGlite;
let dentist = '';

beforeAll(async () => {
  db = await createTestDb();
  await seedStaff(db);
  const r = await db.query<{ id: string }>(`INSERT INTO dentists (name) VALUES ('د. قواعد الرصيد') RETURNING id`);
  dentist = r.rows[0].id;
}, 120_000);

const owner = () => as.user(USERS.owner);
const TODAY = `(now() AT TIME ZONE 'Africa/Cairo')::date`;

describe('opening balance rules (016)', () => {
  it('rejects amount 0', async () => {
    const r = await attempt(db, owner(),
      `INSERT INTO dentist_opening_balances (dentist_id, amount, as_of) VALUES ($1, 0, ${TODAY})`, [dentist]);
    expect(r.ok).toBe(false);
    expect(r.hint).toBe('err.opening_balance.zero_amount');
  });

  it('rejects a date after today (Cairo)', async () => {
    const r = await attempt(db, owner(),
      `INSERT INTO dentist_opening_balances (dentist_id, amount, as_of) VALUES ($1, 100, ${TODAY} + 1)`, [dentist]);
    expect(r.ok).toBe(false);
    expect(r.hint).toBe('err.opening_balance.future_date');
  });

  it('rejects changing an existing balance to 0 or to a future date', async () => {
    await attempt(db, owner(),
      `INSERT INTO dentist_opening_balances (dentist_id, amount, as_of) VALUES ($1, 100, ${TODAY})`, [dentist], { keep: true });
    const zero = await attempt(db, owner(), `UPDATE dentist_opening_balances SET amount = 0 WHERE dentist_id = $1`, [dentist]);
    expect(zero.hint).toBe('err.opening_balance.zero_amount');
    const future = await attempt(db, owner(),
      `UPDATE dentist_opening_balances SET as_of = ${TODAY} + 30 WHERE dentist_id = $1`, [dentist]);
    expect(future.hint).toBe('err.opening_balance.future_date');
  });

  it('still accepts today and past dates, positive and negative amounts', async () => {
    for (const [amount, as_of] of [['250.50', `${TODAY}`], ['-80', `${TODAY} - 400`]]) {
      const r = await attempt(db, owner(),
        `UPDATE dentist_opening_balances SET amount = $2::numeric, as_of = ${as_of} WHERE dentist_id = $1 RETURNING amount`,
        [dentist, amount]);
      expect(r.error).toBeUndefined();
      expect(Number((r.rows[0] as { amount: string }).amount)).toBe(Number(amount));
    }
  });
});
