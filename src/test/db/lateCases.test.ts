// @vitest-environment node
/**
 * Late-case alerts (migration 013): get_late_cases / get_late_case_counts.
 * Only owner and receptionist may call them; dates are taken in Africa/Cairo.
 * Prove they fail before the migration: DB_MIGRATIONS_EXCLUDE=013 npx vitest run src/test/db/lateCases.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, seedStaff, seedCase, attempt, as, USERS } from './harness';

let db: PGlite;
const ids: Record<string, string> = {};

async function seedDue(key: string, status: string, offsetDays: number | null, technician: string | null = null) {
  const id = await seedCase(db, { status, technician, patient: `Fake ${key}` });
  await db.query(
    `UPDATE cases SET due_date = CASE WHEN $2::int IS NULL THEN NULL
       ELSE (now() AT TIME ZONE 'Africa/Cairo')::date + $2::int END,
       dentist_id = (SELECT id FROM dentists WHERE name = 'Fake Doctor')
     WHERE id = $1`,
    [id, offsetDays],
  );
  ids[key] = id;
}

beforeAll(async () => {
  db = await createTestDb();
  await seedStaff(db);
  await db.query(`INSERT INTO dentists (name, phone) VALUES ('Fake Doctor', '01012345678')`);
  await seedDue('late', 'in_progress', -3, USERS.techA);
  await seedDue('yesterday', 'registered', -1);
  await seedDue('today', 'assigned', 0, USERS.techB);
  await seedDue('future', 'in_progress', 2, USERS.techA);
  await seedDue('noDue', 'registered', null);
  await seedDue('deliveredLate', 'delivered', -5, USERS.techA);
  await seedDue('cancelledLate', 'cancelled', -5);
  await seedDue('cancelledToday', 'cancelled', 0);
  // Ready for delivery but the date has passed: still late (intended).
  await seedDue('readyLate', 'awaiting_representative_pickup', -2);
  await seedDue('receivedLate', 'received_by_reception', -1);
}, 120_000);

type Row = { id: string; bucket: string; case_number: string; patient_name: string; dentist_name: string | null;
  dentist_phone: string | null; technician_name: string | null; due_date: string; current_status: string };

describe('late cases: who may call', () => {
  for (const who of ['owner', 'receptionist'] as const) {
    it(`${who} can list late cases and counts`, async () => {
      const r = await attempt<Row>(db, as.user(USERS[who]), `SELECT * FROM public.get_late_cases()`);
      expect(r.error).toBeUndefined();
      expect(r.rows.length).toBe(5);
      const c = await attempt<{ late_count: number; today_count: number }>(db, as.user(USERS[who]),
        `SELECT * FROM public.get_late_case_counts()`);
      expect(c.error).toBeUndefined();
      expect(Number(c.rows[0].late_count)).toBe(4);
      expect(Number(c.rows[0].today_count)).toBe(1);
    });
  }

  for (const who of ['techA', 'rep'] as const) {
    it(`${who} is refused`, async () => {
      const r = await attempt(db, as.user(USERS[who]), `SELECT * FROM public.get_late_cases()`);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/not permitted|permission denied/i);
      const c = await attempt(db, as.user(USERS[who]), `SELECT * FROM public.get_late_case_counts()`);
      expect(c.ok).toBe(false);
    });
  }

  it('an inactive owner or receptionist is refused', async () => {
    const inactive = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2'];
    const roles = ['owner', 'receptionist'];
    for (let i = 0; i < inactive.length; i++) {
      await db.query(
        `INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
         VALUES ($1, $2, '{"full_name": "Fake Inactive"}', now())`,
        [inactive[i], `inactive${i}@example.test`],
      );
      await db.query(`UPDATE profiles SET role = $2::app_role, status = 'inactive' WHERE id = $1`, [
        inactive[i],
        roles[i],
      ]);
      const r = await attempt(db, as.user(inactive[i]), `SELECT * FROM public.get_late_cases()`);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/not permitted/i);
      expect((await attempt(db, as.user(inactive[i]), `SELECT * FROM public.get_late_case_counts()`)).ok).toBe(false);
    }
  });

  it('anon is refused', async () => {
    expect((await attempt(db, as.anon, `SELECT * FROM public.get_late_cases()`)).ok).toBe(false);
    expect((await attempt(db, as.anon, `SELECT * FROM public.get_late_case_counts()`)).ok).toBe(false);
  });

  it('the Cairo date helper is internal only', async () => {
    expect((await attempt(db, as.user(USERS.owner), `SELECT private.cairo_date(now())`)).ok).toBe(false);
  });
});

describe('late cases: buckets', () => {
  it('splits late / today and excludes future, undated, delivered and cancelled', async () => {
    const r = await attempt<Row>(db, as.user(USERS.owner), `SELECT * FROM public.get_late_cases()`);
    const byId = Object.fromEntries(r.rows.map((x) => [x.id, x]));
    expect(byId[ids.late].bucket).toBe('late');
    expect(byId[ids.yesterday].bucket).toBe('late');
    expect(byId[ids.today].bucket).toBe('today');
    for (const k of ['future', 'noDue', 'deliveredLate', 'cancelledLate', 'cancelledToday']) {
      expect(byId[ids[k]]).toBeUndefined();
    }
  });

  it('a case ready for delivery whose date has passed is late (intended)', async () => {
    const r = await attempt<Row>(db, as.user(USERS.receptionist), `SELECT * FROM public.get_late_cases()`);
    const byId = Object.fromEntries(r.rows.map((x) => [x.id, x]));
    expect(byId[ids.readyLate].bucket).toBe('late');
    expect(byId[ids.readyLate].current_status).toBe('awaiting_representative_pickup');
    expect(byId[ids.receivedLate].bucket).toBe('late');
  });

  it('returns the doctor phone, technician name and case details', async () => {
    const r = await attempt<Row>(db, as.user(USERS.receptionist), `SELECT * FROM public.get_late_cases()`);
    const row = r.rows.find((x) => x.id === ids.late)!;
    expect(row.dentist_name).toBe('Fake Doctor');
    expect(row.dentist_phone).toBe('01012345678');
    expect(row.technician_name).toBe('Test techA');
    expect(row.patient_name).toBe('Fake late');
    expect(row.current_status).toBe('in_progress');
    expect(row.case_number).toMatch(/^CASE-/);
    const noTech = r.rows.find((x) => x.id === ids.yesterday)!;
    expect(noTech.technician_name).toBeNull();
  });

  it('late cases come first, oldest due date first', async () => {
    const r = await attempt<Row>(db, as.user(USERS.owner), `SELECT * FROM public.get_late_cases()`);
    expect(r.rows.map((x) => x.id)).toEqual([ids.late, ids.readyLate, ids.yesterday, ids.receivedLate, ids.today]);
  });
});

describe('late cases: Cairo midnight', () => {
  const cairo = async (ts: string) =>
    (await db.query<{ d: string }>(`SELECT private.cairo_date($1::timestamptz)::text AS d`, [ts])).rows[0].d;

  it('00:30 Cairo on 1 November (winter, UTC+2) is 1 November', async () => {
    expect(await cairo('2026-10-31 22:30:00+00')).toBe('2026-11-01');
  });
  it('23:30 Cairo on 31 October is still 31 October', async () => {
    expect(await cairo('2026-10-31 21:30:00+00')).toBe('2026-10-31');
  });
  it('00:30 Cairo on 1 July (summer time, UTC+3) is 1 July', async () => {
    expect(await cairo('2026-06-30 21:30:00+00')).toBe('2026-07-01');
  });
  it('23:30 Cairo on 30 June (summer time) is still 30 June', async () => {
    expect(await cairo('2026-06-30 20:30:00+00')).toBe('2026-06-30');
  });
});
