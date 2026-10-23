// @vitest-environment node
/**
 * Migration 017: every statement line carries is_reversed (true only for a payment
 * that already has a reversal), so the statement page needs no extra query to decide
 * whether to offer "reverse". Prove it fails before the migration:
 *   DB_MIGRATIONS_EXCLUDE=017 npx vitest run src/test/db/statementReversed.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, seedStaff, attempt, as, USERS } from './harness';

let db: PGlite;
let dentist = '';
const ids: Record<string, string> = {};

async function pay(amount: string, at: string, reverses: string | null = null) {
  const r = await db.query<{ id: string }>(
    `INSERT INTO payments (dentist_id, amount, method, received_at, reverses_payment_id)
     VALUES ($1, $2::numeric, 'cash', $3::timestamptz, $4) RETURNING id`,
    [dentist, amount, at, reverses],
  );
  return r.rows[0].id;
}

beforeAll(async () => {
  db = await createTestDb();
  await seedStaff(db);
  dentist = (await db.query<{ id: string }>(`INSERT INTO dentists (name) VALUES ('د. إلغاء') RETURNING id`)).rows[0].id;
  ids.reversedPay = await pay('300', '2026-03-02T10:00:00Z');
  ids.livePay = await pay('100', '2026-03-03T10:00:00Z');
  ids.reversal = await pay('-300', '2026-03-04T10:00:00Z', ids.reversedPay);
  // A payment reversed AFTER the period still counts as reversed.
  ids.laterReversed = await pay('50', '2026-03-05T10:00:00Z');
  await pay('-50', '2026-05-01T10:00:00Z', ids.laterReversed);
  await db.query(`INSERT INTO dentist_opening_balances (dentist_id, amount, as_of) VALUES ($1, 200, '2026-03-01')`, [dentist]);
}, 120_000);

type Line = { kind: string; payment_id: string | null; is_reversed: boolean };

describe('get_dentist_statement: is_reversed per line (017)', () => {
  it('flags payments that have a reversal, even one outside the period', async () => {
    for (const who of [USERS.owner, USERS.receptionist]) {
      const r = await attempt<{ s: { lines: Line[] } }>(db, as.user(who),
        `SELECT public.get_dentist_statement($1, '2026-03-01', '2026-03-31') AS s`, [dentist]);
      expect(r.error).toBeUndefined();
      const byPayment = Object.fromEntries(r.rows[0].s.lines.filter((l) => l.payment_id).map((l) => [l.payment_id, l.is_reversed]));
      expect(byPayment).toEqual({
        [ids.reversedPay]: true,
        [ids.livePay]: false,
        [ids.reversal]: false,
        [ids.laterReversed]: true,
      });
      const opening = r.rows[0].s.lines.find((l) => l.kind === 'opening');
      expect(opening?.is_reversed).toBe(false);
    }
  });

  it('still refuses technicians and representatives', async () => {
    for (const who of [USERS.techA, USERS.rep]) {
      const r = await attempt(db, as.user(who), `SELECT public.get_dentist_statement($1, '2026-03-01', '2026-03-31')`, [dentist]);
      expect(r.hint).toBe('err.money.forbidden');
    }
  });
});
