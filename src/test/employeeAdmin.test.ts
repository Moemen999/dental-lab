import { describe, it, expect } from 'vitest';
import type { Profile } from '@/types/database';

/**
 * Simulates the business logic of `protect_last_active_owner` trigger and deactivation
 */
export function canDeactivateUser(
  targetUser: Profile,
  activeOwnersList: Profile[]
): { allowed: boolean; reason?: string } {
  if (targetUser.role === 'owner') {
    const remainingActiveOwners = activeOwnersList.filter(
      (o) => o.id !== targetUser.id && o.status === 'active'
    );
    if (remainingActiveOwners.length === 0) {
      return {
        allowed: false,
        reason: 'Cannot deactivate, demote, or delete the last active Owner account',
      };
    }
  }
  return { allowed: true };
}

describe('Owner & Employee Administration Guardrails', () => {
  const owner1: Profile = {
    id: 'owner-1',
    email: 'labowner@dentallab.com',
    full_name: 'Dr. Marcus Vance',
    role: 'owner',
    status: 'active',
    phone: null,
    avatar_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deactivated_at: null,
  };

  const owner2: Profile = {
    id: 'owner-2',
    email: 'coowner@dentallab.com',
    full_name: 'Dr. Helen Vance',
    role: 'owner',
    status: 'active',
    phone: null,
    avatar_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deactivated_at: null,
  };

  const tech1: Profile = {
    id: 'tech-1',
    email: 'alex.tech@dentallab.com',
    full_name: 'Alex Rivera',
    role: 'technician',
    status: 'active',
    phone: null,
    avatar_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deactivated_at: null,
  };

  it('prohibits deactivating the single active Owner', () => {
    const singleOwnerList = [owner1];
    const check = canDeactivateUser(owner1, singleOwnerList);

    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('last active Owner account');
  });

  it('allows deactivating an Owner if another active Owner exists', () => {
    const multipleOwnersList = [owner1, owner2];
    const check = canDeactivateUser(owner1, multipleOwnersList);

    expect(check.allowed).toBe(true);
  });

  it('allows deactivating a non-owner employee', () => {
    const singleOwnerList = [owner1];
    const check = canDeactivateUser(tech1, singleOwnerList);

    expect(check.allowed).toBe(true);
  });

  it('identifies outstanding cases for a departing technician and requires reassignment', () => {
    const activeCases = [
      { id: 'c-1', case_number: 'CASE-202610-00001', assigned_technician_id: 'tech-1', status: 'in_progress' },
      { id: 'c-2', case_number: 'CASE-202610-00002', assigned_technician_id: 'tech-1', status: 'assigned' },
      { id: 'c-3', case_number: 'CASE-202610-00003', assigned_technician_id: 'tech-2', status: 'in_progress' },
    ];

    const tech1Cases = activeCases.filter((c) => c.assigned_technician_id === tech1.id);
    expect(tech1Cases).toHaveLength(2);

    // Reassign all to tech-2
    const replacementTechId = 'tech-2';
    const reassignedCases = tech1Cases.map((c) => ({
      ...c,
      assigned_technician_id: replacementTechId,
    }));

    expect(reassignedCases[0].assigned_technician_id).toBe('tech-2');
    expect(reassignedCases[1].assigned_technician_id).toBe('tech-2');
  });
});
