// @vitest-environment node
/**
 * Role permission tests for migration 004_permission_fixes.sql.
 * Run before the fix with: DB_MIGRATIONS_EXCLUDE=004 npm run test:db
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, seedStaff, seedCase, seedBatch, attempt, as, USERS } from './harness';

let db: PGlite;
let repBatch: string;
let otherRepBatch: string;
let closedRepBatch: string;

beforeAll(async () => {
  db = await createTestDb();
  await seedStaff(db);
  repBatch = await seedBatch(db, { reference: 'BATCH-T-001', representative: USERS.rep });
  otherRepBatch = await seedBatch(db, { reference: 'BATCH-T-002', representative: USERS.rep2 });
  closedRepBatch = await seedBatch(db, { reference: 'BATCH-T-003', representative: USERS.rep, status: 'closed' });
}, 120_000);

const changed = (r: { ok: boolean; rows: unknown[] }) => r.ok && r.rows.length > 0;

// ---------------------------------------------------------------------------
// Issue 1: representative could edit an entire batch
// ---------------------------------------------------------------------------
describe('Representative batch permissions', () => {
  it('cannot close or confirm their own batch', async () => {
    const r = await attempt(db, as.user(USERS.rep),
      `UPDATE delivery_batches SET status = 'closed', confirmed_at = now() WHERE id = $1 RETURNING id`, [repBatch]);
    expect(changed(r)).toBe(false);
  });

  it('cannot change receptionist, representative or the verified count', async () => {
    for (const set of [
      `receptionist_id = '${USERS.receptionist}'`,
      `representative_id = '${USERS.rep2}'`,
      `actual_count = 99`,
      `batch_reference = 'HIJACKED'`,
    ]) {
      const r = await attempt(db, as.user(USERS.rep),
        `UPDATE delivery_batches SET ${set} WHERE id = $1 RETURNING id`, [repBatch]);
      expect(changed(r), set).toBe(false);
    }
  });

  it("cannot edit another representative's batch", async () => {
    const r = await attempt(db, as.user(USERS.rep),
      `UPDATE delivery_batches SET notes = 'mine now' WHERE id = $1 RETURNING id`, [otherRepBatch]);
    expect(changed(r)).toBe(false);
  });

  it('cannot edit a batch that is already closed', async () => {
    const r = await attempt(db, as.user(USERS.rep),
      `UPDATE delivery_batches SET notes = 'late edit' WHERE id = $1 RETURNING id`, [closedRepBatch]);
    expect(changed(r)).toBe(false);
  });

  it('cannot create a batch for another representative or as already closed', async () => {
    const forOther = await attempt(db, as.user(USERS.rep),
      `INSERT INTO delivery_batches (batch_reference, batch_type, representative_id)
       VALUES ('BATCH-T-010', 'intake', $1) RETURNING id`, [USERS.rep2]);
    expect(forOther.ok).toBe(false);

    const closed = await attempt(db, as.user(USERS.rep),
      `INSERT INTO delivery_batches (batch_reference, batch_type, representative_id, status, confirmed_at)
       VALUES ('BATCH-T-011', 'intake', $1, 'closed', now()) RETURNING id`, [USERS.rep]);
    expect(closed.ok).toBe(false);
  });

  // ---- still allowed ----
  it('STILL ALLOWED: creates an open intake batch for themselves', async () => {
    const r = await attempt(db, as.user(USERS.rep),
      `INSERT INTO delivery_batches (batch_reference, batch_type, status, representative_id, expected_count, notes)
       VALUES ('BATCH-T-020', 'intake', 'open', $1, 4, 'picked up 4 boxes') RETURNING status`, [USERS.rep]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toEqual([{ status: 'open' }]);
  });

  it('STILL ALLOWED: logs notes, expected count and a discrepancy on their own open batch', async () => {
    const r = await attempt(db, as.user(USERS.rep),
      `UPDATE delivery_batches
          SET notes = 'clinic gave 2 extra', expected_count = 5, discrepancy_notes = 'one box damaged'
        WHERE id = $1 RETURNING expected_count`, [repBatch]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toEqual([{ expected_count: 5 }]);
  });

  it('STILL ALLOWED: receptionist confirms and closes the batch', async () => {
    const r = await attempt(db, as.user(USERS.receptionist),
      `UPDATE delivery_batches SET status = 'closed', confirmed_at = now(), receptionist_id = $2
        WHERE id = $1 RETURNING status`, [repBatch, USERS.receptionist]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toEqual([{ status: 'closed' }]);
  });
});

// ---------------------------------------------------------------------------
// Issue 2: receptionist could make technician / representative transitions
// ---------------------------------------------------------------------------
const transition = (uid: string, caseId: string, to: string) =>
  attempt(db, as.user(uid), `SELECT id FROM transition_case_status($1, $2::case_status)`, [caseId, to]);

describe('Receptionist status transitions', () => {
  const forbidden: Array<[from: string, to: string]> = [
    ['assigned', 'in_progress'],
    ['on_hold', 'in_progress'],
    ['rework_required', 'in_progress'],
    ['in_progress', 'completed'],
    ['in_progress', 'awaiting_reception_receipt'],
    ['completed', 'awaiting_reception_receipt'],
    ['awaiting_representative_pickup', 'with_representative'],
    ['with_representative', 'delivered'],
  ];

  for (const [from, to] of forbidden) {
    it(`cannot move ${from} -> ${to}`, async () => {
      const id = await seedCase(db, { status: from, technician: USERS.techA });
      const r = await transition(USERS.receptionist, id, to);
      expect(r.ok).toBe(false);
    });
  }

  const allowed: Array<[from: string, to: string]> = [
    ['registered', 'awaiting_assignment'],
    ['assigned', 'awaiting_assignment'],
    ['assigned', 'on_hold'],
    ['in_progress', 'on_hold'],
    ['on_hold', 'assigned'],
    ['completed', 'rework_required'],
    ['rework_required', 'assigned'],
    ['awaiting_reception_receipt', 'received_by_reception'],
    ['received_by_reception', 'awaiting_representative_pickup'],
    ['in_progress', 'cancelled'],
  ];

  for (const [from, to] of allowed) {
    it(`STILL ALLOWED: ${from} -> ${to}`, async () => {
      const id = await seedCase(db, { status: from, technician: USERS.techA });
      const r = await transition(USERS.receptionist, id, to);
      expect(r.ok, r.error).toBe(true);
    });
  }

  it('STILL ALLOWED: receptionist assigns a technician', async () => {
    const id = await seedCase(db, { status: 'awaiting_assignment' });
    const r = await attempt(db, as.user(USERS.receptionist),
      `UPDATE cases SET assigned_technician_id = $2, current_status = 'assigned' WHERE id = $1 RETURNING id`,
      [id, USERS.techA]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toHaveLength(1);
  });

  it('STILL ALLOWED: owner can still start work on a case', async () => {
    const id = await seedCase(db, { status: 'assigned', technician: USERS.techA });
    const r = await transition(USERS.owner, id, 'in_progress');
    expect(r.ok, r.error).toBe(true);
  });

  it('STILL ALLOWED: the assigned technician starts work', async () => {
    const id = await seedCase(db, { status: 'assigned', technician: USERS.techA });
    const r = await transition(USERS.techA, id, 'in_progress');
    expect(r.ok, r.error).toBe(true);
  });
});
