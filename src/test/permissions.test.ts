import { describe, it, expect } from 'vitest';
import type { AppRole, CaseStatus } from '@/types/database';
import { VALID_TRANSITIONS } from '@/types/database';

/**
 * Server-side authorization rules matching database trigger `validate_case_status_transition`
 */
export function checkTransitionAuthorization(
  actorRole: AppRole,
  actorIsActive: boolean,
  caseAssignedTechId: string | null,
  actorId: string,
  fromStatus: CaseStatus,
  toStatus: CaseStatus
): { allowed: boolean; reason?: string } {
  // 1. Account must be active
  if (!actorIsActive) {
    return { allowed: false, reason: 'Account is not active' };
  }

  // 2. Transition must be valid in the state machine
  const allowedNext = VALID_TRANSITIONS[fromStatus] || [];
  if (!allowedNext.includes(toStatus)) {
    return { allowed: false, reason: `Invalid transition from ${fromStatus} to ${toStatus}` };
  }

  // 3. Role specific restrictions
  if (actorRole === 'technician') {
    // Technicians cannot set reception/representative/cancellation statuses
    const forbiddenForTech: CaseStatus[] = [
      'registered',
      'awaiting_assignment',
      'assigned',
      'received_by_reception',
      'awaiting_representative_pickup',
      'with_representative',
      'delivered',
      'cancelled',
    ];
    if (forbiddenForTech.includes(toStatus)) {
      return { allowed: false, reason: 'Technicians cannot transition to this status' };
    }

    // Must be assigned to this specific case
    if (caseAssignedTechId !== actorId) {
      return { allowed: false, reason: 'Technicians can only update their own assigned cases' };
    }
  }

  if (actorRole === 'representative') {
    // Representatives can only perform pickup and final delivery
    const allowedForRep: CaseStatus[] = ['with_representative', 'delivered'];
    if (!allowedForRep.includes(toStatus)) {
      return { allowed: false, reason: 'Representatives can only update pickup and delivery statuses' };
    }
  }

  if (actorRole === 'receptionist') {
    // Receptionist cannot jump into technician in_progress or directly mark completed
    if (toStatus === 'in_progress' && fromStatus !== 'assigned') {
      return { allowed: false, reason: 'Receptionist cannot set arbitrary in_progress transitions' };
    }
  }

  return { allowed: true };
}

describe('Server-side Role-Based Access Control and State Transitions', () => {
  const TECH_1 = 'tech-uuid-1';
  const TECH_2 = 'tech-uuid-2';
  const REP_1 = 'rep-uuid-1';
  const RECEP_1 = 'recep-uuid-1';
  const OWNER_1 = 'owner-uuid-1';

  it('rejects any action from deactivated accounts', () => {
    const res = checkTransitionAuthorization(
      'owner',
      false, // deactivated
      null,
      OWNER_1,
      'awaiting_assignment',
      'assigned'
    );
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('not active');
  });

  it('allows technician to advance assigned case from assigned -> in_progress -> completed', () => {
    // Assigned to In Progress
    const step1 = checkTransitionAuthorization(
      'technician',
      true,
      TECH_1,
      TECH_1,
      'assigned',
      'in_progress'
    );
    expect(step1.allowed).toBe(true);

    // In Progress to Completed
    const step2 = checkTransitionAuthorization(
      'technician',
      true,
      TECH_1,
      TECH_1,
      'in_progress',
      'completed'
    );
    expect(step2.allowed).toBe(true);
  });

  it('prohibits technician from modifying another technicians case (IDOR prevention)', () => {
    const attempt = checkTransitionAuthorization(
      'technician',
      true,
      TECH_2, // Assigned to Tech 2
      TECH_1, // Action attempted by Tech 1
      'assigned',
      'in_progress'
    );
    expect(attempt.allowed).toBe(false);
    expect(attempt.reason).toContain('their own assigned cases');
  });

  it('prohibits technician from marking a case as delivered directly to dentist', () => {
    const attempt = checkTransitionAuthorization(
      'technician',
      true,
      TECH_1,
      TECH_1,
      'in_progress',
      'delivered'
    );
    expect(attempt.allowed).toBe(false);
  });

  it('prohibits representative from modifying unreleased production cases', () => {
    const attempt = checkTransitionAuthorization(
      'representative',
      true,
      TECH_1,
      REP_1,
      'assigned',
      'in_progress'
    );
    expect(attempt.allowed).toBe(false);
  });

  it('allows representative to mark picked up and delivered in sequence', () => {
    const pickup = checkTransitionAuthorization(
      'representative',
      true,
      TECH_1,
      REP_1,
      'awaiting_representative_pickup',
      'with_representative'
    );
    expect(pickup.allowed).toBe(true);

    const deliver = checkTransitionAuthorization(
      'representative',
      true,
      TECH_1,
      REP_1,
      'with_representative',
      'delivered'
    );
    expect(deliver.allowed).toBe(true);
  });

  it('allows receptionist to mark case received by reception from awaiting receipt', () => {
    const res = checkTransitionAuthorization(
      'receptionist',
      true,
      TECH_1,
      RECEP_1,
      'awaiting_reception_receipt',
      'received_by_reception'
    );
    expect(res.allowed).toBe(true);
  });

  it('rejects invalid state jumps such as registered -> delivered', () => {
    const jump = checkTransitionAuthorization(
      'owner',
      true,
      null,
      OWNER_1,
      'registered',
      'delivered'
    );
    expect(jump.allowed).toBe(false);
    expect(jump.reason).toContain('Invalid transition');
  });
});
