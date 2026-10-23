// @vitest-environment node
/**
 * KNOWN_ISSUES #9: case numbers must use the lab's local month (Africa/Cairo), not UTC.
 * Run before the fix with: DB_MIGRATIONS_EXCLUDE=012 npm run test:db
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createTestDb, seedStaff, seedWorkType, appCaseJaw, attempt, as, USERS } from './harness';

let db: PGlite;
let jaw = { col: '', val: '' };

beforeAll(async () => {
  db = await createTestDb();
  await seedStaff(db);
  await seedWorkType(db, 'Crown');
  jaw = await appCaseJaw(db); // a jaw is required from migration 014
}, 120_000);

const monthAt = async (ts: string) =>
  (await db.query<{ m: string }>(`SELECT private.case_number_month($1::timestamptz) AS m`, [ts])).rows[0].m;

describe('Issue 9: case number month uses Africa/Cairo', () => {
  it('00:30 Cairo on 1 November (winter, UTC+2) belongs to November', async () => {
    expect(await monthAt('2026-10-31 22:30:00+00')).toBe('202611');
  });

  it('00:30 Cairo on 1 July (summer time, UTC+3) belongs to July', async () => {
    expect(await monthAt('2026-06-30 21:30:00+00')).toBe('202607');
  });

  it('23:30 Cairo on 31 January stays in January', async () => {
    expect(await monthAt('2027-01-31 21:30:00+00')).toBe('202701');
  });

  it('a case registered from the app gets the current Cairo month', async () => {
    const r = await attempt<{ case_number: string; cairo: string }>(db, as.user(USERS.receptionist),
      `INSERT INTO cases (patient_name, case_type${jaw.col})
       VALUES ('Fake TZ', 'Crown'${jaw.val})
       RETURNING case_number, to_char(now() AT TIME ZONE 'Africa/Cairo', 'YYYYMM') AS cairo`);
    expect(r.error).toBeUndefined();
    expect(r.rows[0].case_number).toMatch(new RegExp(`^CASE-${r.rows[0].cairo}-\\d{5,}$`));
  });

  it('re-applying the migration does not change existing case numbers', async () => {
    const id = (await db.query<{ id: string }>(
      `INSERT INTO cases (case_number, patient_name, case_type)
       VALUES ('CASE-202609-00042', 'Fake Old', 'Crown') RETURNING id`)).rows[0].id;
    const file = path.resolve(import.meta.dirname, '../../../supabase/migrations/012_case_number_cairo_time.sql');
    await db.exec(readFileSync(file, 'utf8'));
    const r = await db.query<{ case_number: string }>(`SELECT case_number FROM cases WHERE id = $1`, [id]);
    expect(r.rows[0].case_number).toBe('CASE-202609-00042');
  });

  it('clients still cannot call the generator or the month helper', async () => {
    expect((await attempt(db, as.anon, `SELECT generate_case_number()`)).ok).toBe(false);
    expect((await attempt(db, as.user(USERS.owner), `SELECT private.case_number_month(now())`)).ok).toBe(false);
  });
});
