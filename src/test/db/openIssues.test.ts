// @vitest-environment node
/**
 * Tests for the KNOWN_ISSUES fixed in migrations 006 onward.
 * Run before a fix with e.g.: DB_MIGRATIONS_EXCLUDE=006 npm run test:db
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, seedStaff, seedCase, seedBatch, seedWorkType, appCaseJaw, attempt, as, USERS } from './harness';

let db: PGlite;
let jaw = { col: '', val: '' };

beforeAll(async () => {
  db = await createTestDb();
  await seedStaff(db);
  // idleTech plays an inactive technician in this file.
  await db.query(`UPDATE profiles SET status = 'inactive' WHERE id = $1`, [USERS.idleTech]);
  jaw = await appCaseJaw(db); // a jaw is required from migration 014
}, 120_000);

const assign = (uid: string, caseId: string, techId: string) =>
  attempt(db, as.user(uid),
    `UPDATE cases SET assigned_technician_id = $2, current_status = 'assigned' WHERE id = $1 RETURNING id`,
    [caseId, techId]);

// ---------------------------------------------------------------------------
// Issue 3: UPDATE could assign a case to a non-technician or inactive user
// ---------------------------------------------------------------------------
describe('Issue 3: assigned technician is validated on UPDATE', () => {
  const invalid: Array<[label: string, id: string]> = [
    ['a representative', USERS.rep],
    ['a receptionist', USERS.receptionist],
    ['the owner', USERS.owner],
    ['an inactive technician', USERS.idleTech],
  ];

  for (const [label, techId] of invalid) {
    it(`receptionist cannot assign a case to ${label}`, async () => {
      const id = await seedCase(db, { status: 'awaiting_assignment' });
      const r = await assign(USERS.receptionist, id, techId);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/active technician/);
    });
  }

  it('owner cannot swap the technician to a representative without a status change', async () => {
    const id = await seedCase(db, { status: 'assigned', technician: USERS.techA });
    const r = await attempt(db, as.user(USERS.owner),
      `UPDATE cases SET assigned_technician_id = $2 WHERE id = $1 RETURNING id`, [id, USERS.rep]);
    expect(r.ok).toBe(false);
  });

  it('STILL ALLOWED: receptionist assigns an active technician', async () => {
    const id = await seedCase(db, { status: 'awaiting_assignment' });
    const r = await assign(USERS.receptionist, id, USERS.techA);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toHaveLength(1);
  });

  it('STILL ALLOWED: editing other columns of a case whose technician was later deactivated', async () => {
    const id = await seedCase(db, { status: 'assigned', technician: USERS.idleTech });
    const r = await attempt(db, as.user(USERS.receptionist),
      `UPDATE cases SET special_instructions = 'call the clinic' WHERE id = $1 RETURNING id`, [id]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Issue 4: assignment history trusted assigned_by from the client and was
// written in a separate request
// ---------------------------------------------------------------------------
interface AssignmentRow {
  technician_id: string;
  assigned_by: string;
  is_active: boolean;
}

async function assignments(caseId: string) {
  const r = await db.query<AssignmentRow>(
    `SELECT technician_id, assigned_by, is_active FROM technician_assignments
      WHERE case_id = $1 ORDER BY assigned_at, is_active`, [caseId]);
  return r.rows;
}

describe('Issue 4: assignment history is written by the database', () => {
  it('receptionist cannot insert an assignment row with a forged assigned_by', async () => {
    const id = await seedCase(db, { status: 'awaiting_assignment' });
    const r = await attempt(db, as.user(USERS.receptionist),
      `INSERT INTO technician_assignments (case_id, technician_id, assigned_by)
       VALUES ($1, $2, $3) RETURNING id`, [id, USERS.techA, USERS.owner]);
    expect(r.ok).toBe(false);
  });

  it('receptionist cannot rewrite an existing assignment row', async () => {
    const id = await seedCase(db, { status: 'assigned', technician: USERS.techA });
    // Existing history row, written by the trusted seed path.
    await db.query(
      `INSERT INTO technician_assignments (case_id, technician_id, assigned_by) VALUES ($1, $2, $3)`,
      [id, USERS.techA, USERS.receptionist]);
    const r = await attempt(db, as.user(USERS.receptionist),
      `UPDATE technician_assignments SET assigned_by = $2 WHERE case_id = $1 RETURNING id`, [id, USERS.owner]);
    expect(r.ok && r.rows.length > 0).toBe(false);
  });

  it('assigning a case writes one active row with the real caller, in the same statement', async () => {
    const id = await seedCase(db, { status: 'awaiting_assignment' });
    const r = await attempt(db, as.user(USERS.receptionist),
      `UPDATE cases SET assigned_technician_id = $2, current_status = 'assigned' WHERE id = $1 RETURNING id`,
      [id, USERS.techA], { keep: true });
    expect(r.ok, r.error).toBe(true);
    expect(await assignments(id)).toEqual([
      { technician_id: USERS.techA, assigned_by: USERS.receptionist, is_active: true },
    ]);
  });

  it('reassigning closes the old row, opens a new one and logs a reassigned event', async () => {
    const id = await seedCase(db, { status: 'awaiting_assignment' });
    await attempt(db, as.user(USERS.receptionist),
      `UPDATE cases SET assigned_technician_id = $2, current_status = 'assigned' WHERE id = $1`,
      [id, USERS.techA], { keep: true });
    const r = await attempt(db, as.user(USERS.owner),
      `UPDATE cases SET assigned_technician_id = $2 WHERE id = $1 RETURNING id`,
      [id, USERS.techB], { keep: true });
    expect(r.ok, r.error).toBe(true);

    const rows = await assignments(id);
    expect(rows.filter((a) => a.is_active)).toEqual([
      { technician_id: USERS.techB, assigned_by: USERS.owner, is_active: true },
    ]);
    expect(rows).toHaveLength(2);

    const events = await db.query<{ event_type: string; actor_id: string; assignment_id: string }>(
      `SELECT event_type, actor_id, assignment_id FROM case_events WHERE case_id = $1 ORDER BY created_at`, [id]);
    expect(events.rows.map((e) => e.event_type)).toEqual(['assigned', 'reassigned']);
    expect(events.rows[1]).toEqual({ event_type: 'reassigned', actor_id: USERS.owner, assignment_id: USERS.techB });
  });

  it('a failed case update leaves no assignment row behind', async () => {
    const id = await seedCase(db, { status: 'awaiting_assignment' });
    const r = await assign(USERS.receptionist, id, USERS.rep);
    expect(r.ok).toBe(false);
    expect(await assignments(id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Issue 5: deactivating a technician without a replacement failed when they
// had a case in progress
// ---------------------------------------------------------------------------
describe('Issue 5: deactivation without a replacement', () => {
  it('owner deactivates a technician with an in_progress case; the case returns to the queue', async () => {
    const tech = '00000000-0000-4000-8000-000000000101';
    await db.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
       VALUES ($1, 'leaving.tech@example.test', '{"full_name":"Test Leaving Tech"}', now())`, [tech]);
    await db.query(`UPDATE profiles SET role = 'technician', status = 'active' WHERE id = $1`, [tech]);
    const inProgress = await seedCase(db, { status: 'in_progress', technician: tech });
    const assigned = await seedCase(db, { status: 'assigned', technician: tech });
    const onHold = await seedCase(db, { status: 'on_hold', technician: tech });

    const r = await attempt(db, as.user(USERS.owner),
      `SELECT reassign_and_deactivate_technician($1, NULL, 'left the lab') AS r`, [tech], { keep: true });
    expect(r.ok, r.error).toBe(true);

    const cases = await db.query<{ id: string; current_status: string; assigned_technician_id: string | null }>(
      `SELECT id, current_status, assigned_technician_id FROM cases WHERE id = ANY($1) ORDER BY current_status`,
      [[inProgress, assigned, onHold]]);
    expect(cases.rows.map((c) => [c.current_status, c.assigned_technician_id])).toEqual([
      ['awaiting_assignment', null],
      ['awaiting_assignment', null],
      ['on_hold', null],
    ]);

    const ev = await db.query<{ event_type: string; previous_status: string; actor_id: string; notes: string }>(
      `SELECT event_type, previous_status, actor_id, notes FROM case_events WHERE case_id = $1`, [inProgress]);
    expect(ev.rows).toHaveLength(1);
    expect(ev.rows[0]).toMatchObject({ event_type: 'reassigned', previous_status: 'in_progress', actor_id: USERS.owner });
    expect(ev.rows[0].notes).toMatch(/left the lab/);

    const status = await db.query<{ status: string }>(`SELECT status FROM profiles WHERE id = $1`, [tech]);
    expect(status.rows[0].status).toBe('inactive');
  });

  it('a receptionist still cannot pull an in_progress case back to the queue', async () => {
    const id = await seedCase(db, { status: 'in_progress', technician: USERS.techA });
    const r = await attempt(db, as.user(USERS.receptionist),
      `UPDATE cases SET assigned_technician_id = NULL, current_status = 'awaiting_assignment'
        WHERE id = $1 RETURNING id`, [id]);
    expect(r.ok).toBe(false);
  });

  it('the owner cannot move in_progress to awaiting_assignment while keeping the technician', async () => {
    const id = await seedCase(db, { status: 'in_progress', technician: USERS.techA });
    const r = await attempt(db, as.user(USERS.owner),
      `SELECT id FROM transition_case_status($1, 'awaiting_assignment')`, [id]);
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Issue 6: registering a case wrote no event and no assignment row
// ---------------------------------------------------------------------------
describe('Issue 6: registration history', () => {
  const register = (techId: string | null) =>
    attempt<{ id: string }>(db, as.user(USERS.receptionist),
      `INSERT INTO cases (patient_name, case_type, assigned_technician_id${jaw.col})
       VALUES ('Fake Patient R', 'Test Retainer', $1${jaw.val}) RETURNING id`, [techId], { keep: true });

  beforeAll(async () => {
    await seedWorkType(db, 'Test Retainer');
  });

  it('registration without a technician writes a created event', async () => {
    const r = await register(null);
    expect(r.ok, r.error).toBe(true);
    const id = r.rows[0].id;

    const ev = await db.query(
      `SELECT event_type, previous_status, new_status, actor_id, assignment_id FROM case_events WHERE case_id = $1`, [id]);
    expect(ev.rows).toEqual([{
      event_type: 'created', previous_status: null, new_status: 'awaiting_assignment',
      actor_id: USERS.receptionist, assignment_id: null,
    }]);
    expect(await assignments(id)).toEqual([]);
  });

  it('registration with a technician also writes the active assignment row', async () => {
    const r = await register(USERS.techA);
    expect(r.ok, r.error).toBe(true);
    const id = r.rows[0].id;

    const ev = await db.query(`SELECT event_type, new_status, assignment_id FROM case_events WHERE case_id = $1`, [id]);
    expect(ev.rows).toEqual([{ event_type: 'created', new_status: 'assigned', assignment_id: USERS.techA }]);
    expect(await assignments(id)).toEqual([
      { technician_id: USERS.techA, assigned_by: USERS.receptionist, is_active: true },
    ]);
  });

  it('a rejected registration leaves no event behind', async () => {
    const r = await register(USERS.rep);
    expect(r.ok).toBe(false);
    const ev = await db.query(
      `SELECT 1 FROM case_events e JOIN cases c ON c.id = e.case_id WHERE c.assigned_technician_id = $1`, [USERS.rep]);
    expect(ev.rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Issue 8: representatives could add cases to any batch; client-side count
// ---------------------------------------------------------------------------
describe('Issue 8: adding cases to batches', () => {
  const addCase = (uid: string, batchId: string, caseId: string, addedBy: string = uid) =>
    attempt<{ added_by: string }>(db, as.user(uid),
      `INSERT INTO batch_cases (batch_id, case_id, added_by) VALUES ($1, $2, $3) RETURNING added_by`,
      [batchId, caseId, addedBy], { keep: true });

  const count = async (batchId: string) =>
    (await db.query<{ actual_count: number }>(
      `SELECT actual_count FROM delivery_batches WHERE id = $1`, [batchId])).rows[0].actual_count;

  it('representative cannot add a case to a batch of another representative', async () => {
    const batch = await seedBatch(db, { reference: 'BATCH-I8-001', representative: USERS.rep2 });
    const c = await seedCase(db, { status: 'awaiting_assignment' });
    const r = await addCase(USERS.rep, batch, c);
    expect(r.ok).toBe(false);
    expect(await count(batch)).toBe(0);
  });

  it('representative cannot add a case to their own closed batch', async () => {
    const batch = await seedBatch(db, { reference: 'BATCH-I8-002', representative: USERS.rep, status: 'closed' });
    const c = await seedCase(db, { status: 'awaiting_assignment' });
    const r = await addCase(USERS.rep, batch, c);
    expect(r.ok).toBe(false);
  });

  it('added_by is always the caller, never a client value', async () => {
    const batch = await seedBatch(db, { reference: 'BATCH-I8-003' });
    const c = await seedCase(db, { status: 'awaiting_assignment' });
    const r = await addCase(USERS.receptionist, batch, c, USERS.owner);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows[0].added_by).toBe(USERS.receptionist);
  });

  it('STILL ALLOWED: representative adds cases to their own open batch and the count follows', async () => {
    const batch = await seedBatch(db, { reference: 'BATCH-I8-004', representative: USERS.rep });
    for (let i = 0; i < 3; i++) {
      const c = await seedCase(db, { status: 'awaiting_assignment' });
      const r = await addCase(USERS.rep, batch, c);
      expect(r.ok, r.error).toBe(true);
    }
    expect(await count(batch)).toBe(3);
  });

  it('representative still cannot set actual_count directly', async () => {
    const batch = await seedBatch(db, { reference: 'BATCH-I8-005', representative: USERS.rep });
    const r = await attempt(db, as.user(USERS.rep),
      `UPDATE delivery_batches SET actual_count = 50 WHERE id = $1 RETURNING id`, [batch]);
    expect(r.ok && r.rows.length > 0).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Issue 11: case search pasted user text into the PostgREST filter string
// ---------------------------------------------------------------------------
describe('Issue 11: parameterized case search', () => {
  let tricky: string;
  let other: string;

  beforeAll(async () => {
    tricky = await seedCase(db, { status: 'assigned', technician: USERS.techA, patient: 'Fake, Patient (100%)_x' });
    other = await seedCase(db, { status: 'assigned', technician: USERS.techB, patient: 'Fake Other Patient' });
  });

  const search = (uid: string, q: string) =>
    attempt<{ id: string }>(db, as.user(uid), `SELECT id FROM search_cases($1)`, [q]);

  it('matches filter syntax characters literally', async () => {
    for (const q of [',', 'Patient (100%)', '%)_x', 'fake, patient']) {
      const r = await search(USERS.owner, q);
      expect(r.ok, r.error).toBe(true);
      expect(r.rows.map((x) => x.id), q).toEqual([tricky]);
    }
  });

  it('wildcards do not match everything', async () => {
    for (const q of ['%', '_', '*']) {
      const r = await search(USERS.owner, q);
      expect(r.rows.map((x) => x.id), q).not.toContain(other);
    }
  });

  it('a PostgREST filter injection string is just text', async () => {
    const r = await search(USERS.owner, 'x%,current_status.neq.cancelled');
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toEqual([]);
  });

  it('RLS still applies: a technician finds only their own cases', async () => {
    const r = await search(USERS.techB, 'Fake');
    expect(r.ok, r.error).toBe(true);
    expect(r.rows.map((x) => x.id)).toContain(other);
    expect(r.rows.map((x) => x.id)).not.toContain(tricky);
  });

  it('anonymous callers cannot search', async () => {
    const anon = await attempt(db, as.anon, `SELECT id FROM search_cases('Fake')`);
    expect(anon.ok && anon.rows.length > 0).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Issue 7: the UI hid nothing; the database already denies representative notes.
// This pins the server rule that canAddCaseNote() mirrors.
// ---------------------------------------------------------------------------
describe('Issue 7: representatives cannot add case notes', () => {
  it('rejects a note from a representative', async () => {
    const id = await seedCase(db, { status: 'with_representative' });
    const r = await attempt(db, as.user(USERS.rep),
      `SELECT record_case_event($1, 'note_added', NULL, NULL, 'Fake note') AS id`, [id]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Not permitted to add case notes/);
  });
});
