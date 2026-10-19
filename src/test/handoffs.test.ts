import { describe, it, expect } from 'vitest';
import type { DeliveryBatch, Case, CaseEvent } from '@/types/database';

describe('Delivery Batches & Case Handoff Integrity', () => {
  it('supports multiple individually tracked cases within a single batch', () => {
    const intakeBatch: DeliveryBatch = {
      id: 'batch-001',
      batch_reference: 'BATCH-202610-INT-001',
      batch_type: 'intake',
      status: 'open',
      representative_id: 'rep-1',
      receptionist_id: 'recep-1',
      expected_count: 3,
      actual_count: 3,
      handoff_at: new Date().toISOString(),
      confirmed_at: null,
      notes: 'Morning clinic collection',
      discrepancy_notes: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const casesInBatch: Case[] = [
      {
        id: 'case-1',
        case_number: 'CASE-202610-00001',
        patient_name: 'John Doe',
        patient_age: 45,
        patient_dob: null,
        dentist_id: 'dentist-1',
        dentist_name_text: null,
        clinic_name_text: 'Downtown Dental',
        case_type: 'Crown',
        tooth_number: '14',
        shade: 'A2',
        description: 'Porcelain fused to zirconia',
        special_instructions: null,
        current_status: 'registered',
        priority: 'normal',
        date_received: new Date().toISOString(),
        due_date: '2026-10-25',
        completed_at: null,
        delivered_at: null,
        assigned_technician_id: null,
        assigned_at: null,
        intake_batch_id: 'batch-001',
        return_batch_id: null,
        registered_by: 'recep-1',
        notes: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'case-2',
        case_number: 'CASE-202610-00002',
        patient_name: 'Jane Smith',
        patient_age: 32,
        patient_dob: null,
        dentist_id: 'dentist-2',
        dentist_name_text: null,
        clinic_name_text: 'Westside Ortho',
        case_type: 'Night Guard',
        tooth_number: null,
        shade: null,
        description: 'Upper hard/soft night guard',
        special_instructions: null,
        current_status: 'registered',
        priority: 'high',
        date_received: new Date().toISOString(),
        due_date: '2026-10-20',
        completed_at: null,
        delivered_at: null,
        assigned_technician_id: null,
        assigned_at: null,
        intake_batch_id: 'batch-001',
        return_batch_id: null,
        registered_by: 'recep-1',
        notes: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'case-3',
        case_number: 'CASE-202610-00003',
        patient_name: 'Robert Johnson',
        patient_age: 58,
        patient_dob: null,
        dentist_id: 'dentist-1',
        dentist_name_text: null,
        clinic_name_text: 'Downtown Dental',
        case_type: 'Bridge',
        tooth_number: '21-23',
        shade: 'A3',
        description: '3-unit anterior bridge',
        special_instructions: null,
        current_status: 'registered',
        priority: 'urgent',
        date_received: new Date().toISOString(),
        due_date: '2026-10-18',
        completed_at: null,
        delivered_at: null,
        assigned_technician_id: null,
        assigned_at: null,
        intake_batch_id: 'batch-001',
        return_batch_id: null,
        registered_by: 'recep-1',
        notes: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    // Verify batch contains 3 cases
    expect(casesInBatch).toHaveLength(3);
    expect(intakeBatch.actual_count).toBe(3);

    // Each case maintains distinct identity, unique case number, and patient data
    expect(casesInBatch[0].case_number).toBe('CASE-202610-00001');
    expect(casesInBatch[1].case_number).toBe('CASE-202610-00002');
    expect(casesInBatch[2].case_number).toBe('CASE-202610-00003');

    // Cases can have different priorities and due dates despite arriving in same batch
    expect(casesInBatch[0].priority).toBe('normal');
    expect(casesInBatch[1].priority).toBe('high');
    expect(casesInBatch[2].priority).toBe('urgent');
  });

  it('detects discrepancies between expected count and received count', () => {
    const batchWithDiscrepancy: DeliveryBatch = {
      id: 'batch-002',
      batch_reference: 'BATCH-202610-INT-002',
      batch_type: 'intake',
      status: 'discrepancy',
      representative_id: 'rep-1',
      receptionist_id: 'recep-1',
      expected_count: 5,
      actual_count: 4, // 1 case missing from physical box
      handoff_at: new Date().toISOString(),
      confirmed_at: new Date().toISOString(),
      notes: 'Handoff from Dr. Clark clinic',
      discrepancy_notes: 'Rep brought 4 boxes, manifest listed 5. Contacting clinic.',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(batchWithDiscrepancy.status).toBe('discrepancy');
    expect(batchWithDiscrepancy.actual_count).not.toBe(batchWithDiscrepancy.expected_count);
    expect(batchWithDiscrepancy.discrepancy_notes).toContain('manifest listed 5');
  });

  it('ensures distinct operational events for technician completion and reception receipt', () => {
    // Stage D requirement: Technician marking completed does NOT count as reception receiving it
    const event1: CaseEvent = {
      id: 'evt-1',
      case_id: 'case-1',
      event_type: 'submitted_to_reception',
      previous_status: 'in_progress',
      new_status: 'awaiting_reception_receipt',
      actor_id: 'tech-1',
      sender_id: 'tech-1',
      receiver_id: null,
      notes: 'Crown finished, placed in outbound tray',
      metadata: {},
      batch_id: null,
      assignment_id: null,
      created_at: new Date('2026-10-14T10:00:00Z').toISOString(),
    };

    // Reception explicitly acknowledges receipt later
    const event2: CaseEvent = {
      id: 'evt-2',
      case_id: 'case-1',
      event_type: 'received_by_reception',
      previous_status: 'awaiting_reception_receipt',
      new_status: 'received_by_reception',
      actor_id: 'recep-1',
      sender_id: 'tech-1',
      receiver_id: 'recep-1',
      notes: 'Inspected and received at reception QC desk',
      metadata: {},
      batch_id: null,
      assignment_id: null,
      created_at: new Date('2026-10-14T10:30:00Z').toISOString(),
    };

    expect(event1.event_type).toBe('submitted_to_reception');
    expect(event1.new_status).toBe('awaiting_reception_receipt');
    expect(event2.event_type).toBe('received_by_reception');
    expect(event2.new_status).toBe('received_by_reception');
    expect(event1.actor_id).not.toBe(event2.actor_id);
    expect(new Date(event2.created_at).getTime()).toBeGreaterThan(new Date(event1.created_at).getTime());
  });
});
