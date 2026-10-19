import { describe, it, expect } from 'vitest';
import { transitionsForRole, VALID_TRANSITIONS } from '@/types/database';

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
