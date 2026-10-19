import { describe, it, expect } from 'vitest';
import { VALID_TRANSITIONS, CASE_STATUS_LABELS, type CaseStatus } from '@/types/database';

describe('Case Workflow State Machine', () => {
  it('defines valid transitions for all statuses', () => {
    const allStatuses: CaseStatus[] = [
      'intake_pending',
      'registered',
      'awaiting_assignment',
      'assigned',
      'in_progress',
      'completed',
      'awaiting_reception_receipt',
      'received_by_reception',
      'awaiting_representative_pickup',
      'with_representative',
      'delivered',
      'on_hold',
      'rework_required',
      'cancelled',
    ];

    allStatuses.forEach((status) => {
      expect(VALID_TRANSITIONS).toHaveProperty(status);
      expect(Array.isArray(VALID_TRANSITIONS[status])).toBe(true);
      expect(CASE_STATUS_LABELS).toHaveProperty(status);
    });
  });

  it('allows natural clinical progression', () => {
    // intake_pending -> awaiting_assignment
    expect(VALID_TRANSITIONS.intake_pending).toContain('awaiting_assignment');

    // awaiting_assignment -> assigned
    expect(VALID_TRANSITIONS.awaiting_assignment).toContain('assigned');

    // assigned -> in_progress
    expect(VALID_TRANSITIONS.assigned).toContain('in_progress');

    // in_progress -> completed
    expect(VALID_TRANSITIONS.in_progress).toContain('completed');

    // completed -> awaiting_reception_receipt
    expect(VALID_TRANSITIONS.completed).toContain('awaiting_reception_receipt');

    // awaiting_reception_receipt -> received_by_reception
    expect(VALID_TRANSITIONS.awaiting_reception_receipt).toContain('received_by_reception');

    // received_by_reception -> awaiting_representative_pickup
    expect(VALID_TRANSITIONS.received_by_reception).toContain('awaiting_representative_pickup');

    // awaiting_representative_pickup -> with_representative
    expect(VALID_TRANSITIONS.awaiting_representative_pickup).toContain('with_representative');

    // with_representative -> delivered
    expect(VALID_TRANSITIONS.with_representative).toContain('delivered');
  });

  it('prohibits transitions from terminal statuses', () => {
    expect(VALID_TRANSITIONS.delivered).toEqual([]);
    expect(VALID_TRANSITIONS.cancelled).toEqual([]);
  });

  it('allows pause on hold and rework recovery', () => {
    expect(VALID_TRANSITIONS.in_progress).toContain('on_hold');
    expect(VALID_TRANSITIONS.on_hold).toContain('in_progress');
    expect(VALID_TRANSITIONS.completed).toContain('rework_required');
    expect(VALID_TRANSITIONS.rework_required).toContain('assigned');
  });
});
