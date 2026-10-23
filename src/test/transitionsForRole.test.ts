import { describe, it, expect } from 'vitest';
import { canAddCaseNote, transitionsForRole, VALID_TRANSITIONS } from '@/types/database';

describe('transitionsForRole', () => {
  it('hides technician and representative steps from receptionists', () => {
    expect(transitionsForRole('receptionist', 'assigned')).toEqual(['awaiting_assignment', 'on_hold', 'cancelled']);
    expect(transitionsForRole('receptionist', 'awaiting_representative_pickup')).toEqual(['cancelled']);
    expect(transitionsForRole('receptionist', 'awaiting_reception_receipt')).toContain('received_by_reception');
  });

  it('leaves other roles unchanged', () => {
    expect(transitionsForRole('owner', 'assigned')).toEqual(VALID_TRANSITIONS.assigned);
    expect(transitionsForRole(undefined, 'in_progress')).toEqual(VALID_TRANSITIONS.in_progress);
  });
});

describe('canAddCaseNote', () => {
  // Same roles as record_case_event in 003; representatives are denied there.
  it('allows owner, receptionist and technician', () => {
    expect(canAddCaseNote('owner')).toBe(true);
    expect(canAddCaseNote('receptionist')).toBe(true);
    expect(canAddCaseNote('technician')).toBe(true);
  });

  it('hides the note action from representatives and unknown users', () => {
    expect(canAddCaseNote('representative')).toBe(false);
    expect(canAddCaseNote(undefined)).toBe(false);
  });
});
