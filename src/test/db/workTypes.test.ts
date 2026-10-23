// @vitest-environment node
/**
 * Owner-managed work types (migration 005_work_types.sql).
 * Run before the fix with: DB_MIGRATIONS_EXCLUDE=005 npm run test:db
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, seedStaff, seedCase, seedWorkType, appCaseJaw, attempt, attemptTx, as, USERS } from './harness';

let db: PGlite;
let activeTypeId: string | null;
let inactiveTypeId: string | null;
let jaw = { col: '', val: '' };

// Neutral fake names: real types are entered by the lab owner.
const ACTIVE = 'نوع تجريبي أ';
const INACTIVE = 'نوع تجريبي موقوف';

beforeAll(async () => {
  db = await createTestDb();
  await seedStaff(db);
  activeTypeId = await seedWorkType(db, ACTIVE);
  inactiveTypeId = await seedWorkType(db, INACTIVE, false);
  jaw = await appCaseJaw(db); // a jaw is required from migration 014
}, 120_000);

/** Blocked by permissions/rules, not because the table is missing. */
function blocked(r: { ok: boolean; rows: unknown[]; error?: string }): boolean {
  if (r.ok) return r.rows.length === 0;
  return !/does not exist/.test(r.error ?? '');
}

const insertType = (uid: string | null, name: string) =>
  attempt(db, uid ? as.user(uid) : as.anon, `INSERT INTO work_types (name) VALUES ($1) RETURNING id, name`, [name]);

describe('who can manage work types', () => {
  it('blocks anonymous users from reading', async () => {
    const r = await attempt(db, as.anon, 'SELECT id FROM work_types');
    expect(blocked(r)).toBe(true);
  });

  it('blocks anonymous users from inserting', async () => {
    expect(blocked(await insertType(null, 'نوع من مجهول'))).toBe(true);
  });

  it.each([
    ['receptionist', USERS.receptionist],
    ['technician', USERS.techA],
    ['representative', USERS.rep],
  ])('blocks a %s from inserting', async (_role, uid) => {
    expect(blocked(await insertType(uid, 'نوع من غير المالك'))).toBe(true);
  });

  it('blocks a receptionist from renaming or deactivating', async () => {
    const r = await attempt(db, as.user(USERS.receptionist),
      `UPDATE work_types SET name = 'تغيير', is_active = false WHERE id = $1 RETURNING id`, [activeTypeId]);
    expect(blocked(r)).toBe(true);
  });

  it('blocks hard delete, even for the owner', async () => {
    const r = await attempt(db, as.user(USERS.owner), 'DELETE FROM work_types WHERE id = $1 RETURNING id', [activeTypeId]);
    expect(blocked(r)).toBe(true);
  });

  it('rejects duplicate names ignoring case and surrounding spaces', async () => {
    const r = await insertType(USERS.owner, `  ${ACTIVE}  `);
    expect(blocked(r)).toBe(true);
    const latin = await attemptTx(db, as.user(USERS.owner), async (tx) => {
      await tx.query(`INSERT INTO work_types (name) VALUES ('Test Type')`);
      await tx.query(`INSERT INTO work_types (name) VALUES ('  test type ')`);
    });
    expect(blocked({ ok: latin.ok, rows: [], error: latin.error })).toBe(true);
  });

  it('rejects an empty name', async () => {
    expect(blocked(await insertType(USERS.owner, '   '))).toBe(true);
  });

  // ---- still allowed ----
  it('STILL ALLOWED: owner adds a type (name is stored trimmed)', async () => {
    const r = await insertType(USERS.owner, '  نوع جديد  ');
    expect(r.ok, r.error).toBe(true);
    expect(r.rows[0]).toMatchObject({ name: 'نوع جديد' });
  });

  it('STILL ALLOWED: owner renames, deactivates, reactivates and reorders', async () => {
    const r = await attemptTx(db, as.user(USERS.owner), async (tx) => {
      await tx.query(`UPDATE work_types SET name = 'اسم معدّل' WHERE id = $1`, [activeTypeId]);
      await tx.query(`UPDATE work_types SET is_active = false WHERE id = $1`, [activeTypeId]);
      await tx.query(`UPDATE work_types SET is_active = true, sort_order = 5 WHERE id = $1`, [activeTypeId]);
      return (await tx.query(`SELECT name, is_active, sort_order FROM work_types WHERE id = $1`, [activeTypeId])).rows;
    });
    expect(r.ok, r.error).toBe(true);
    expect(r.value).toEqual([{ name: 'اسم معدّل', is_active: true, sort_order: 5 }]);
  });

  it('STILL ALLOWED: staff read active types only; the owner also sees inactive ones', async () => {
    const tech = await attempt<{ id: string }>(db, as.user(USERS.techA), 'SELECT id FROM work_types');
    expect(tech.ok, tech.error).toBe(true);
    expect(tech.rows.map((x) => x.id)).toEqual([activeTypeId]);

    const owner = await attempt<{ id: string }>(db, as.user(USERS.owner), 'SELECT id FROM work_types');
    expect(owner.rows.map((x) => x.id).sort()).toEqual([activeTypeId, inactiveTypeId].sort());
  });
});

describe('audit trail', () => {
  it('records create, rename and deactivate in audit_logs with the owner as actor', async () => {
    const r = await attemptTx(db, as.user(USERS.owner), async (tx) => {
      const ins = await tx.query<{ id: string }>(`INSERT INTO work_types (name) VALUES ('نوع للتدقيق') RETURNING id`);
      const id = ins.rows[0].id;
      await tx.query(`UPDATE work_types SET name = 'نوع للتدقيق 2' WHERE id = $1`, [id]);
      await tx.query(`UPDATE work_types SET is_active = false WHERE id = $1`, [id]);
      const logs = await tx.query<{ actor_id: string; op: string }>(
        `SELECT actor_id, details->>'op' AS op FROM audit_logs
          WHERE target_id = $1 AND target_type = 'work_type' ORDER BY created_at, id`, [id]);
      return logs.rows;
    });
    expect(r.ok, r.error).toBe(true);
    expect(r.value?.map((x) => x.op).sort()).toEqual(['created', 'deactivated', 'renamed']);
    expect(new Set(r.value?.map((x) => x.actor_id))).toEqual(new Set([USERS.owner]));
  });
});

describe('cases use the active list', () => {
  const register = (caseType: string) =>
    attempt(db, as.user(USERS.receptionist),
      `INSERT INTO cases (patient_name, case_type${jaw.col}) VALUES ('مريض تجريبي', $1${jaw.val}) RETURNING case_type`, [caseType]);

  it('rejects a case type that is not in the list', async () => {
    const r = await register('Crown');
    expect(blocked(r)).toBe(true);
    expect(r.hint).not.toBe('err.case.jaw_required');
  });

  it('rejects an inactive type', async () => {
    const inactive = await register(INACTIVE);
    expect(blocked(inactive)).toBe(true);
    expect(inactive.hint).not.toBe('err.case.jaw_required');
  });

  it('rejects changing an existing case to an unknown type', async () => {
    const id = await seedCase(db, { status: 'awaiting_assignment' });
    const r = await attempt(db, as.user(USERS.receptionist),
      `UPDATE cases SET case_type = 'Bridge' WHERE id = $1 RETURNING id`, [id]);
    expect(blocked(r)).toBe(true);
  });

  it('STILL ALLOWED: registering with an active type', async () => {
    const r = await register(ACTIVE);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toEqual([{ case_type: ACTIVE }]);
  });

  it('STILL ALLOWED: old cases keep their legacy type and can still be edited', async () => {
    // seedCase stores the legacy value 'Crown' through the trusted path.
    const id = await seedCase(db, { status: 'awaiting_assignment' });
    const r = await attempt(db, as.user(USERS.receptionist),
      `UPDATE cases SET shade = 'A2' WHERE id = $1 RETURNING case_type, shade`, [id]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toEqual([{ case_type: 'Crown', shade: 'A2' }]);
  });
});
