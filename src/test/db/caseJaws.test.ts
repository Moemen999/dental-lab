// @vitest-environment node
/**
 * Upper / lower jaw instead of shade and tooth number (migration 014_case_jaws.sql).
 * - A case registered from the app needs at least one jaw.
 * - Old cases keep shade / tooth_number and NULL jaws, and stay readable and editable.
 * - Technicians and representatives still cannot change case data (guard from 003).
 * Prove they fail before the migration:
 *   DB_MIGRATIONS_EXCLUDE=014 npx vitest run src/test/db/caseJaws.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, seedStaff, seedCase, seedWorkType, attempt, as, USERS, type AttemptResult } from './harness';

let db: PGlite;
let legacyCase: string;
let newCase: string;

// Neutral fake work type: real types are entered by the lab owner.
const TYPE = 'نوع تجريبي للفكين';
const JAW_REQUIRED = 'err.case.jaw_required';

type Jaws = { upper_jaw: boolean | null; lower_jaw: boolean | null };

/** Blocked by the rules, not because a column is missing (pre-014 schema). */
function blocked(r: AttemptResult<unknown>): boolean {
  if (r.ok) return r.rows.length === 0;
  return !/does not exist/.test(r.error ?? '');
}

const register = (uid: string, upper: boolean | null, lower: boolean | null, keep = false) =>
  attempt<{ id: string } & Jaws>(db, as.user(uid),
    `INSERT INTO cases (patient_name, case_type, assigned_technician_id, upper_jaw, lower_jaw)
     VALUES ('Fake Jaw Patient', $1, $2, $3, $4) RETURNING id, upper_jaw, lower_jaw`,
    [TYPE, USERS.techA, upper, lower], { keep });

beforeAll(async () => {
  db = await createTestDb();
  await seedStaff(db);
  await seedWorkType(db, TYPE);

  // A case from before 014 (trusted seed path): shade + tooth number, no jaw data.
  legacyCase = await seedCase(db, { status: 'assigned', technician: USERS.techA, patient: 'Fake Legacy Patient' });
  await db.query(
    `UPDATE cases SET shade = 'A2', tooth_number = '14', due_date = current_date - 3 WHERE id = $1`,
    [legacyCase],
  );

  // A case registered from the app after 014 (upper jaw only), kept for later tests.
  const r = await register(USERS.receptionist, true, false, true);
  newCase = r.rows[0]?.id;
}, 120_000);

describe('registering a case needs a jaw', () => {
  it.each([
    ['receptionist', USERS.receptionist],
    ['owner', USERS.owner],
  ])('rejects a %s registering with neither jaw', async (_role, uid) => {
    for (const [upper, lower] of [[null, null], [false, false], [null, false]] as const) {
      const r = await register(uid, upper, lower);
      expect(r.ok, `upper=${upper} lower=${lower}`).toBe(false);
      expect(r.hint).toBe(JAW_REQUIRED);
      expect(r.error).toMatch(/at least one jaw/i);
    }
  });

  it('rejects a registration that leaves the jaw columns out entirely', async () => {
    const r = await attempt(db, as.user(USERS.receptionist),
      `INSERT INTO cases (patient_name, case_type) VALUES ('Fake No Jaw', $1) RETURNING id`, [TYPE]);
    expect(r.ok).toBe(false);
    expect(r.hint).toBe(JAW_REQUIRED);
  });

  it.each([
    ['upper only', true, false],
    ['lower only', false, true],
    ['both jaws', true, true],
    ['upper only, lower left empty', true, null],
  ] as const)('STILL ALLOWED: %s', async (_label, upper, lower) => {
    const r = await register(USERS.receptionist, upper, lower);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows[0]).toMatchObject({ upper_jaw: upper, lower_jaw: lower });
  });

  it('STILL ALLOWED: the owner registers with both jaws', async () => {
    const r = await register(USERS.owner, true, true);
    expect(r.ok, r.error).toBe(true);
  });

  it('STILL ALLOWED: trusted sessions (seed scripts, SQL editor, restore) insert without jaws', async () => {
    const id = await seedCase(db, { status: 'registered', patient: 'Fake Seeded' });
    const r = await db.query<Jaws>(`SELECT upper_jaw, lower_jaw FROM cases WHERE id = $1`, [id]);
    expect(r.rows[0]).toEqual({ upper_jaw: null, lower_jaw: null });
  });
});

describe('changing the jaws of a case', () => {
  it('rejects clearing both jaws of a new case', async () => {
    for (const [upper, lower] of [[false, false], [null, null], [null, false]] as const) {
      const r = await attempt(db, as.user(USERS.receptionist),
        `UPDATE cases SET upper_jaw = $2, lower_jaw = $3 WHERE id = $1 RETURNING id`, [newCase, upper, lower]);
      expect(r.ok, `upper=${upper} lower=${lower}`).toBe(false);
      expect(r.hint).toBe(JAW_REQUIRED);
    }
  });

  it('rejects clearing the only chosen jaw of a new case', async () => {
    const r = await attempt(db, as.user(USERS.owner),
      `UPDATE cases SET upper_jaw = false WHERE id = $1 RETURNING id`, [newCase]);
    expect(r.ok).toBe(false);
    expect(r.hint).toBe(JAW_REQUIRED);
  });

  it('rejects setting an old case to "no jaw" explicitly', async () => {
    const r = await attempt(db, as.user(USERS.receptionist),
      `UPDATE cases SET upper_jaw = false WHERE id = $1 RETURNING id`, [legacyCase]);
    expect(r.ok).toBe(false);
    expect(r.hint).toBe(JAW_REQUIRED);
  });

  it('STILL ALLOWED: switching a new case from upper to lower jaw', async () => {
    const r = await attempt<Jaws>(db, as.user(USERS.receptionist),
      `UPDATE cases SET upper_jaw = false, lower_jaw = true WHERE id = $1 RETURNING upper_jaw, lower_jaw`, [newCase]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toEqual([{ upper_jaw: false, lower_jaw: true }]);
  });

  it('STILL ALLOWED: adding a jaw to an old case', async () => {
    const r = await attempt<Jaws>(db, as.user(USERS.owner),
      `UPDATE cases SET lower_jaw = true WHERE id = $1 RETURNING upper_jaw, lower_jaw`, [legacyCase]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toEqual([{ upper_jaw: null, lower_jaw: true }]);
  });
});

describe('old cases (before 014)', () => {
  it('stay readable with their shade and tooth number and no jaw', async () => {
    const r = await attempt<Jaws & { shade: string; tooth_number: string }>(db, as.user(USERS.receptionist),
      `SELECT shade, tooth_number, upper_jaw, lower_jaw FROM cases WHERE id = $1`, [legacyCase]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toEqual([{ shade: 'A2', tooth_number: '14', upper_jaw: null, lower_jaw: null }]);
  });

  it('STILL ALLOWED: a receptionist edits notes, priority and due date; shade and tooth stay as they were', async () => {
    const r = await attempt<Jaws & { shade: string; tooth_number: string; priority: string; notes: string }>(
      db, as.user(USERS.receptionist),
      `UPDATE cases SET notes = 'ملاحظة جديدة', priority = 'high', due_date = current_date + 7
        WHERE id = $1 RETURNING shade, tooth_number, upper_jaw, lower_jaw, priority, notes`, [legacyCase]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toEqual([{
      shade: 'A2', tooth_number: '14', upper_jaw: null, lower_jaw: null, priority: 'high', notes: 'ملاحظة جديدة',
    }]);
  });

  it('STILL ALLOWED: an edit that re-sends the unchanged (empty) jaws', async () => {
    const r = await attempt(db, as.user(USERS.receptionist),
      `UPDATE cases SET notes = 'x', upper_jaw = NULL, lower_jaw = NULL WHERE id = $1 RETURNING id`, [legacyCase]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toHaveLength(1);
  });

  it('STILL ALLOWED: the technician moves an old case through the workflow', async () => {
    const r = await attempt<{ current_status: string }>(db, as.user(USERS.techA),
      `SELECT current_status FROM transition_case_status($1, 'in_progress')`, [legacyCase]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toEqual([{ current_status: 'in_progress' }]);
  });

  it('the shade and tooth number columns and their data are untouched by 014', async () => {
    const cols = await db.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cases'
          AND column_name IN ('shade', 'tooth_number', 'upper_jaw', 'lower_jaw')
        ORDER BY column_name`);
    expect(cols.rows).toEqual([
      { column_name: 'lower_jaw', data_type: 'boolean' },
      { column_name: 'shade', data_type: 'text' },
      { column_name: 'tooth_number', data_type: 'text' },
      { column_name: 'upper_jaw', data_type: 'boolean' },
    ]);
    const r = await db.query(`SELECT shade, tooth_number FROM cases WHERE id = $1`, [legacyCase]);
    expect(r.rows).toEqual([{ shade: 'A2', tooth_number: '14' }]);
  });
});

describe('role permissions are unchanged', () => {
  it('blocks the assigned technician from changing the jaws', async () => {
    for (const set of ['upper_jaw = false, lower_jaw = true', 'lower_jaw = true']) {
      const r = await attempt(db, as.user(USERS.techA), `UPDATE cases SET ${set} WHERE id = $1 RETURNING id`, [newCase]);
      expect(blocked(r), set).toBe(true);
      expect(r.hint).toBe('err.case.status_only');
    }
  });

  it('blocks the technician from adding a jaw to an old case', async () => {
    const r = await attempt(db, as.user(USERS.techA),
      `UPDATE cases SET upper_jaw = true WHERE id = $1 RETURNING id`, [legacyCase]);
    expect(blocked(r)).toBe(true);
    expect(r.hint).toBe('err.case.status_only');
  });

  it('blocks a representative from changing the jaws', async () => {
    const r = await attempt(db, as.user(USERS.rep),
      `UPDATE cases SET upper_jaw = true, lower_jaw = true WHERE id = $1 RETURNING id`, [newCase]);
    expect(blocked(r)).toBe(true);
    expect(r.hint).toBe('err.case.status_only');
  });

  it.each([
    ['technician', USERS.techA],
    ['representative', USERS.rep],
  ])('blocks a %s from registering a case even with a jaw', async (_role, uid) => {
    expect(blocked(await register(uid, true, true))).toBe(true);
  });

  it('a technician still sees only the cases assigned to them', async () => {
    const own = await attempt<{ id: string }>(db, as.user(USERS.techA),
      `SELECT id, upper_jaw FROM cases WHERE id = ANY($1::uuid[])`, [[newCase, legacyCase]]);
    expect(own.ok, own.error).toBe(true);
    expect(own.rows.map((x) => x.id).sort()).toEqual([newCase, legacyCase].sort());

    const other = await attempt<{ id: string }>(db, as.user(USERS.techB),
      `SELECT id, upper_jaw FROM cases WHERE id = ANY($1::uuid[])`, [[newCase, legacyCase]]);
    expect(other.ok, other.error).toBe(true);
    expect(other.rows).toEqual([]);
  });

  it('the trigger function cannot be called by API roles', async () => {
    const r = await db.query<{ anon: boolean; auth: boolean }>(
      `SELECT has_function_privilege('anon', 'public.validate_case_jaws()', 'EXECUTE') AS anon,
              has_function_privilege('authenticated', 'public.validate_case_jaws()', 'EXECUTE') AS auth`);
    expect(r.rows).toEqual([{ anon: false, auth: false }]);
  });
});

describe('existing case functions still work', () => {
  it('search_cases returns the jaw columns', async () => {
    const r = await attempt<{ id: string } & Jaws>(db, as.user(USERS.receptionist),
      `SELECT id, upper_jaw, lower_jaw FROM search_cases('Fake Jaw Patient') WHERE id = $1`, [newCase]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].upper_jaw).toBe(true);
  });

  it('get_late_cases still lists an overdue old case', async () => {
    const id = await seedCase(db, { status: 'registered', patient: 'Fake Late Legacy' });
    await db.query(`UPDATE cases SET shade = 'B1', due_date = current_date - 10 WHERE id = $1`, [id]);
    const r = await attempt<{ id: string; bucket: string }>(db, as.user(USERS.owner),
      `SELECT id, bucket FROM get_late_cases() WHERE id = $1`, [id]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toEqual([{ id, bucket: 'late' }]);
  });
});
