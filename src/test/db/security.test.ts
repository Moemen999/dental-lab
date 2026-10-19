// @vitest-environment node
/**
 * Real-database security tests (PGlite running supabase/migrations).
 * Each "exploit" block reproduces an attack that SUCCEEDED against
 * migrations 001+002 and must be blocked by 003_security_hardening.sql.
 * Run before the fix with: DB_MIGRATIONS_EXCLUDE=003 npm run test:db
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createTestDb, seedStaff, seedCase, seedWorkType, triggerExists, attempt, attemptTx, as, USERS } from './harness';

let db: PGlite;
let techBCase: string;
let pickupCase: string;

beforeAll(async () => {
  db = await createTestDb();
  await seedStaff(db);
  // Test-only work types used by client inserts below (required from migration 005).
  for (const name of ['Crown', 'Bridge', 'Veneer']) await seedWorkType(db, name);
  techBCase = await seedCase(db, { status: 'assigned', technician: USERS.techB, patient: 'Fake Patient B' });
  pickupCase = await seedCase(db, { status: 'awaiting_representative_pickup', technician: USERS.techA });
}, 120_000);

async function profileRole(id: string) {
  const r = await db.query<{ role: string; status: string }>(
    'SELECT role, status FROM profiles WHERE id = $1',
    [id],
  );
  return r.rows[0];
}

describe('Exploit 1: self-promotion to owner via profiles UPDATE', () => {
  it('blocks a technician from changing their own role', async () => {
    const r = await attempt(db, as.user(USERS.techA),
      `UPDATE profiles SET role = 'owner' WHERE id = $1 RETURNING role`, [USERS.techA]);
    expect(r.ok && r.rows.length > 0).toBe(false);
  });

  it('blocks a technician from changing their own status', async () => {
    const r = await attempt(db, as.user(USERS.techA),
      `UPDATE profiles SET status = 'inactive' WHERE id = $1 RETURNING status`, [USERS.techA]);
    expect(r.ok && r.rows.length > 0).toBe(false);
  });

  it('still lets a user edit their own name and phone', async () => {
    const r = await attempt(db, as.user(USERS.techA),
      `UPDATE profiles SET full_name = 'Renamed Tech', phone = '000' WHERE id = $1 RETURNING full_name`,
      [USERS.techA]);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1);
  });

  it('still lets an active owner change another employee role', async () => {
    const r = await attempt(db, as.user(USERS.owner),
      `UPDATE profiles SET role = 'receptionist' WHERE id = $1 RETURNING role`, [USERS.techB]);
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual([{ role: 'receptionist' }]);
  });
});

describe('Exploit 2: patient data leak via get_employee_outstanding_work', () => {
  it('blocks anonymous callers', async () => {
    const r = await attempt(db, as.anon, 'SELECT get_employee_outstanding_work($1) AS w', [USERS.techB]);
    expect(r.ok).toBe(false);
  });

  it('blocks non-owner staff', async () => {
    const r = await attempt(db, as.user(USERS.techA), 'SELECT get_employee_outstanding_work($1) AS w', [USERS.techB]);
    expect(r.ok).toBe(false);
  });

  it('allows an active owner', async () => {
    const r = await attempt<{ w: { active_case_count: number } }>(db, as.user(USERS.owner),
      'SELECT get_employee_outstanding_work($1) AS w', [USERS.techB]);
    expect(r.ok).toBe(true);
    expect(r.rows[0].w.active_case_count).toBe(1);
  });
});

describe('Exploit 3: NULL auth bypass in reassign_and_deactivate_technician', () => {
  it('blocks anonymous callers from deactivating a technician', async () => {
    const r = await attempt(db, as.anon,
      `SELECT reassign_and_deactivate_technician($1, NULL, 'x') AS r`, [USERS.idleTech]);
    expect(r.ok).toBe(false);
    expect((await profileRole(USERS.idleTech)).status).toBe('active');
  });

  it('blocks non-owner staff', async () => {
    const r = await attempt(db, as.user(USERS.receptionist),
      `SELECT reassign_and_deactivate_technician($1, NULL, 'x') AS r`, [USERS.idleTech]);
    expect(r.ok).toBe(false);
  });

  it('lets an owner reassign active cases and records who did it', async () => {
    const r = await attemptTx(db, as.user(USERS.owner), async (tx) => {
      await tx.query(`SELECT reassign_and_deactivate_technician($1, $2, 'leaving')`, [USERS.techB, USERS.techA]);
      const res = await tx.query<{ assigned_by: string; actor_id: string; assigned_technician_id: string }>(
        `SELECT ta.assigned_by, ce.actor_id, c.assigned_technician_id
           FROM cases c
           JOIN technician_assignments ta ON ta.case_id = c.id AND ta.is_active
           JOIN case_events ce ON ce.case_id = c.id AND ce.event_type = 'reassigned'
          WHERE c.id = $1`, [techBCase]);
      return res.rows;
    });
    expect(r.ok, r.error).toBe(true);
    expect(r.value).toEqual([
      { assigned_by: USERS.owner, actor_id: USERS.owner, assigned_technician_id: USERS.techA },
    ]);
  });
});

describe('Exploit 4: anonymous access to generate_case_number', () => {
  it('blocks anonymous callers', async () => {
    const r = await attempt(db, as.anon, 'SELECT generate_case_number() AS n');
    expect(r.ok).toBe(false);
  });

  it('blocks authenticated callers too (only the insert trigger uses it)', async () => {
    const r = await attempt(db, as.user(USERS.receptionist), 'SELECT generate_case_number() AS n');
    expect(r.ok).toBe(false);
  });
});

describe('Exploit 5: editing non-status columns without permission', () => {
  it('blocks a representative from rewriting patient data and assignment', async () => {
    const r = await attempt(db, as.user(USERS.rep),
      `UPDATE cases SET patient_name = 'Tampered', assigned_technician_id = $1 WHERE id = $2 RETURNING id`,
      [USERS.rep, techBCase]);
    expect(r.ok && r.rows.length > 0).toBe(false);
  });

  it('blocks a technician from editing clinical data on their own case', async () => {
    const r = await attempt(db, as.user(USERS.techA),
      `UPDATE cases SET due_date = '2000-01-01', priority = 'urgent' WHERE id = $1 RETURNING id`,
      [pickupCase]);
    expect(r.ok && r.rows.length > 0).toBe(false);
  });

  it('blocks anyone from changing the case number', async () => {
    const r = await attempt(db, as.user(USERS.owner),
      `UPDATE cases SET case_number = 'CASE-199901-00001' WHERE id = $1 RETURNING id`, [techBCase]);
    expect(r.ok && r.rows.length > 0).toBe(false);
  });

  it('still lets a representative confirm pickup', async () => {
    const r = await attempt(db, as.user(USERS.rep),
      `UPDATE cases SET current_status = 'with_representative' WHERE id = $1 RETURNING current_status`,
      [pickupCase]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toEqual([{ current_status: 'with_representative' }]);
  });

  it('still lets a receptionist edit clinical details', async () => {
    const r = await attempt(db, as.user(USERS.receptionist),
      `UPDATE cases SET shade = 'A2' WHERE id = $1 RETURNING shade`, [techBCase]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows).toEqual([{ shade: 'A2' }]);
  });
});

describe('Exploit 6: client-chosen case_number and status on INSERT', () => {
  it('ignores client case_number and status', async () => {
    const r = await attempt<{ case_number: string; current_status: string; registered_by: string }>(
      db, as.user(USERS.owner),
      `INSERT INTO cases (case_number, patient_name, case_type, current_status, registered_by)
       VALUES ('CASE-199901-00001', 'Fake C', 'Crown', 'delivered', $1)
       RETURNING case_number, current_status, registered_by`,
      [USERS.rep]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows[0].case_number).toMatch(/^CASE-\d{6}-\d{5,}$/);
    expect(r.rows[0].case_number).not.toBe('CASE-199901-00001');
    expect(r.rows[0].current_status).toBe('awaiting_assignment');
    expect(r.rows[0].registered_by).toBe(USERS.owner);
  });

  it('derives "assigned" when an active technician is chosen', async () => {
    const r = await attempt<{ current_status: string }>(db, as.user(USERS.receptionist),
      `INSERT INTO cases (patient_name, case_type, current_status, assigned_technician_id)
       VALUES ('Fake D', 'Bridge', 'delivered', $1) RETURNING current_status`,
      [USERS.techA]);
    expect(r.ok, r.error).toBe(true);
    expect(r.rows[0].current_status).toBe('assigned');
  });

  it('rejects assigning a case to a non-technician', async () => {
    const r = await attempt(db, as.user(USERS.receptionist),
      `INSERT INTO cases (patient_name, case_type, assigned_technician_id)
       VALUES ('Fake E', 'Bridge', $1) RETURNING id`,
      [USERS.rep]);
    expect(r.ok).toBe(false);
  });
});

describe('Exploit 7: forging case history', () => {
  it('blocks forged status events through record_case_event', async () => {
    const r = await attempt(db, as.user(USERS.rep),
      `SELECT record_case_event($1, 'delivered', 'assigned', 'delivered', 'forged') AS id`, [techBCase]);
    expect(r.ok).toBe(false);
  });

  it('blocks direct INSERT into case_events', async () => {
    const r = await attempt(db, as.user(USERS.rep),
      `INSERT INTO case_events (case_id, event_type, previous_status, new_status, actor_id)
       VALUES ($1, 'delivered', 'assigned', 'delivered', $2) RETURNING id`, [techBCase, USERS.rep]);
    expect(r.ok).toBe(false);
  });

  it('blocks a technician from adding notes to a case that is not theirs', async () => {
    const r = await attempt(db, as.user(USERS.techB),
      `SELECT record_case_event($1, 'note_added', NULL, NULL, 'hi') AS id`, [pickupCase]);
    expect(r.ok).toBe(false);
  });

  it('still lets a receptionist add a note', async () => {
    const r = await attempt(db, as.user(USERS.receptionist),
      `SELECT record_case_event($1, 'note_added', NULL, NULL, 'shade confirmed by phone') AS id`, [techBCase]);
    expect(r.ok, r.error).toBe(true);
  });

  it('logs status changes automatically with the real actor and notes', async () => {
    const r = await attemptTx(db, as.user(USERS.rep), async (tx) => {
      await tx.query(`SELECT transition_case_status($1, 'with_representative', 'box 3 of 5')`, [pickupCase]);
      const res = await tx.query<{ event_type: string; actor_id: string; notes: string }>(
        `SELECT event_type, actor_id, notes FROM case_events
          WHERE case_id = $1 AND new_status = 'with_representative'`, [pickupCase]);
      return res.rows;
    });
    expect(r.ok, r.error).toBe(true);
    expect(r.value).toEqual([
      { event_type: 'picked_up_by_representative', actor_id: USERS.rep, notes: 'box 3 of 5' },
    ]);
  });
});

describe('Exploit 8: signup metadata granting a role', () => {
  it('does not trust raw_user_meta_data.role on signup', async () => {
    const id = '00000000-0000-4000-8000-0000000000ff';
    await db.query(
      `INSERT INTO auth.users (id, email, raw_user_meta_data, email_confirmed_at)
       VALUES ($1, 'signup@example.test', '{"role":"owner","full_name":"Fake Signup"}', now())`,
      [id]);
    const p = await profileRole(id);
    expect(p.role).toBe('technician');
    expect(p.status).toBe('pending_invitation');
  });
});

describe('Append-only history (regression)', () => {
  it('blocks DELETE on case_events', async () => {
    const r = await attempt(db, as.user(USERS.owner), 'DELETE FROM case_events RETURNING id');
    expect(r.ok && r.rows.length > 0).toBe(false);
  });

  it('blocks UPDATE on audit_logs', async () => {
    const r = await attempt(db, as.user(USERS.owner), `UPDATE audit_logs SET details = '{}' RETURNING id`);
    expect(r.ok && r.rows.length > 0).toBe(false);
  });
});

describe('IDOR (regression)', () => {
  it("blocks a technician from moving another technician's case", async () => {
    const other = await seedCase(db, { status: 'assigned', technician: USERS.idleTech });
    const r = await attempt(db, as.user(USERS.techA),
      `UPDATE cases SET current_status = 'in_progress' WHERE id = $1 RETURNING id`, [other]);
    expect(r.ok && r.rows.length > 0).toBe(false);
  });
});

describe('Full workflow still works after hardening', () => {
  it('runs registration -> assignment -> production -> reception -> delivery with one event per step', async () => {
    const step = async (uid: string, sql: string, params: unknown[]) => {
      const r = await attempt(db, as.user(uid), sql, params, { keep: true });
      expect(r.ok, r.error).toBe(true);
      return r.rows;
    };
    const [{ id }] = (await step(USERS.receptionist,
      `INSERT INTO cases (patient_name, case_type) VALUES ('Fake Flow', 'Veneer') RETURNING id`, [])) as { id: string }[];
    await step(USERS.receptionist,
      `UPDATE cases SET assigned_technician_id = $2, assigned_at = now(), current_status = 'assigned' WHERE id = $1 RETURNING id`,
      [id, USERS.techA]);
    const move = (uid: string, status: string) =>
      step(uid, `SELECT id FROM transition_case_status($1, $2::case_status)`, [id, status]);
    await move(USERS.techA, 'in_progress');
    await move(USERS.techA, 'completed');
    await move(USERS.techA, 'awaiting_reception_receipt');
    await move(USERS.receptionist, 'received_by_reception');
    await move(USERS.receptionist, 'awaiting_representative_pickup');
    await move(USERS.rep, 'with_representative');
    await move(USERS.rep, 'delivered');

    const events = await db.query<{ event_type: string }>(
      'SELECT event_type FROM case_events WHERE case_id = $1 ORDER BY created_at, id', [id]);
    expect(events.rows.map((e) => e.event_type).sort()).toEqual([
      // 'created' from migration 009 (KNOWN_ISSUES #6)
      ...((await triggerExists(db, 'trg_log_case_created')) ? ['created'] : []),
      'assigned', 'completed', 'delivered', 'picked_up_by_representative', 'received_by_reception',
      'released_to_representative', 'submitted_to_reception', 'work_started',
    ].sort());
    const c = await db.query<{ current_status: string; delivered_at: string | null; completed_at: string | null }>(
      'SELECT current_status, delivered_at, completed_at FROM cases WHERE id = $1', [id]);
    expect(c.rows[0].current_status).toBe('delivered');
    expect(c.rows[0].delivered_at).not.toBeNull();
    expect(c.rows[0].completed_at).not.toBeNull();
  });
});
