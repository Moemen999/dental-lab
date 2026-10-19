// =============================================================================
// Database Types for Dental Lab Case Management System
// =============================================================================

import { ar } from '@/i18n/ar';

// ---- Enums ----

export type AppRole = 'owner' | 'representative' | 'receptionist' | 'technician';

export type AccountStatus = 'active' | 'inactive' | 'pending_invitation';

export type CaseStatus =
  | 'intake_pending'
  | 'registered'
  | 'awaiting_assignment'
  | 'assigned'
  | 'in_progress'
  | 'completed'
  | 'awaiting_reception_receipt'
  | 'received_by_reception'
  | 'awaiting_representative_pickup'
  | 'with_representative'
  | 'delivered'
  | 'on_hold'
  | 'rework_required'
  | 'cancelled';

export type CaseEventType =
  | 'created'
  | 'registered'
  | 'assigned'
  | 'reassigned'
  | 'acknowledged'
  | 'work_started'
  | 'completed'
  | 'submitted_to_reception'
  | 'received_by_reception'
  | 'released_to_representative'
  | 'picked_up_by_representative'
  | 'delivered'
  | 'put_on_hold'
  | 'resumed'
  | 'rework_requested'
  | 'cancelled'
  | 'note_added'
  | 'info_updated'
  | 'batch_associated';

export type BatchType = 'intake' | 'return';
export type BatchStatus = 'open' | 'closed' | 'discrepancy';
export type CasePriority = 'low' | 'normal' | 'high' | 'urgent';

export type AuditAction =
  | 'user_created'
  | 'user_updated'
  | 'user_deactivated'
  | 'user_activated'
  | 'user_role_changed'
  | 'user_password_reset'
  | 'user_invitation_sent'
  | 'login_success'
  | 'login_failure'
  | 'case_reassigned'
  | 'case_cancelled'
  | 'case_status_override'
  | 'settings_changed'
  | 'system_event';

// ---- Interfaces ----

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: AppRole;
  status: AccountStatus;
  phone: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
  deactivated_at: string | null;
}

/** Owner-managed list (migration 005). cases.case_type stores the name as text. */
export interface WorkType {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface Dentist {
  id: string;
  name: string;
  clinic_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface DeliveryBatch {
  id: string;
  batch_reference: string;
  batch_type: BatchType;
  status: BatchStatus;
  representative_id: string | null;
  receptionist_id: string | null;
  expected_count: number | null;
  actual_count: number;
  handoff_at: string;
  confirmed_at: string | null;
  notes: string | null;
  discrepancy_notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  representative?: Profile;
  receptionist?: Profile;
  cases?: Case[];
}

export interface Case {
  id: string;
  case_number: string;
  patient_name: string;
  patient_age: number | null;
  patient_dob: string | null;
  dentist_id: string | null;
  dentist_name_text: string | null;
  clinic_name_text: string | null;
  case_type: string;
  tooth_number: string | null;
  shade: string | null;
  description: string | null;
  special_instructions: string | null;
  current_status: CaseStatus;
  priority: CasePriority;
  date_received: string;
  due_date: string | null;
  completed_at: string | null;
  delivered_at: string | null;
  assigned_technician_id: string | null;
  assigned_at: string | null;
  intake_batch_id: string | null;
  return_batch_id: string | null;
  registered_by: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  dentist?: Dentist;
  assigned_technician?: Profile;
  registered_by_profile?: Profile;
}

export interface BatchCase {
  id: string;
  batch_id: string;
  case_id: string;
  added_at: string;
  added_by: string | null;
}

export interface CaseEvent {
  id: string;
  case_id: string;
  event_type: CaseEventType;
  previous_status: CaseStatus | null;
  new_status: CaseStatus | null;
  actor_id: string;
  sender_id: string | null;
  receiver_id: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  batch_id: string | null;
  assignment_id: string | null;
  created_at: string;
  // Joined data
  actor?: Profile;
  sender?: Profile;
  receiver?: Profile;
}

export interface TechnicianAssignment {
  id: string;
  case_id: string;
  technician_id: string;
  assigned_by: string;
  assigned_at: string;
  acknowledged_at: string | null;
  completed_at: string | null;
  unassigned_at: string | null;
  unassign_reason: string | null;
  is_active: boolean;
  notes: string | null;
  // Joined data
  technician?: Profile;
  assigned_by_profile?: Profile;
}

export interface AuditLog {
  id: string;
  action: AuditAction;
  actor_id: string | null;
  target_id: string | null;
  target_type: string | null;
  details: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  // Joined data
  actor?: Profile;
}

// ---- State Machine ----

export const VALID_TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  intake_pending: ['registered', 'awaiting_assignment', 'cancelled'],
  registered: ['awaiting_assignment', 'cancelled'],
  awaiting_assignment: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'awaiting_assignment', 'on_hold', 'cancelled'],
  in_progress: ['completed', 'awaiting_reception_receipt', 'on_hold', 'cancelled'],
  completed: ['awaiting_reception_receipt', 'rework_required', 'cancelled'],
  awaiting_reception_receipt: ['received_by_reception', 'rework_required', 'cancelled'],
  received_by_reception: ['awaiting_representative_pickup', 'rework_required', 'cancelled'],
  awaiting_representative_pickup: ['with_representative', 'cancelled'],
  with_representative: ['delivered', 'cancelled'],
  delivered: [],
  on_hold: ['assigned', 'in_progress', 'awaiting_assignment', 'cancelled'],
  rework_required: ['assigned', 'awaiting_assignment', 'in_progress', 'cancelled'],
  cancelled: [],
};

// Target statuses a receptionist may not set (enforced by migration 004).
const RECEPTIONIST_FORBIDDEN_TARGETS: CaseStatus[] = [
  'in_progress',
  'completed',
  'awaiting_reception_receipt',
  'with_representative',
  'delivered',
];

/** Valid next statuses for UI controls, minus those the database denies the role. */
export function transitionsForRole(role: AppRole | undefined, from: CaseStatus): CaseStatus[] {
  const next = VALID_TRANSITIONS[from] || [];
  if (role !== 'receptionist') return next;
  return next.filter((s) => !RECEPTIONIST_FORBIDDEN_TARGETS.includes(s));
}

// ---- Labels & Colors ----

// Labels come from the Arabic dictionary (src/i18n/ar/enums.ts). The Record types
// make the compiler reject a dictionary that misses any enum value.
export const CASE_STATUS_LABELS: Record<CaseStatus, string> = ar.enums.caseStatus;

export const CASE_STATUS_COLORS: Record<CaseStatus, string> = {
  intake_pending: 'bg-amber-100 text-amber-800 border-amber-200',
  registered: 'bg-blue-100 text-blue-800 border-blue-200',
  awaiting_assignment: 'bg-slate-100 text-slate-800 border-slate-200',
  assigned: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  in_progress: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  completed: 'bg-green-100 text-green-800 border-green-200',
  awaiting_reception_receipt: 'bg-orange-100 text-orange-800 border-orange-200',
  received_by_reception: 'bg-teal-100 text-teal-800 border-teal-200',
  awaiting_representative_pickup: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  with_representative: 'bg-purple-100 text-purple-800 border-purple-200',
  delivered: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  on_hold: 'bg-amber-100 text-amber-800 border-amber-200',
  rework_required: 'bg-red-100 text-red-800 border-red-200',
  cancelled: 'bg-gray-100 text-gray-600 border-gray-200',
};

export const PRIORITY_LABELS: Record<CasePriority, string> = ar.enums.priority;

export const PRIORITY_COLORS: Record<CasePriority, string> = {
  low: 'bg-gray-100 text-gray-600',
  normal: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
};

export const ROLE_LABELS: Record<AppRole, string> = ar.enums.role;

export const EVENT_TYPE_LABELS: Record<CaseEventType, string> = ar.enums.eventType;

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = ar.enums.accountStatus;

export const BATCH_TYPE_LABELS: Record<BatchType, string> = ar.enums.batchType;

export const BATCH_TYPE_LONG_LABELS: Record<BatchType, string> = ar.enums.batchTypeLong;

export const BATCH_STATUS_LABELS: Record<BatchStatus, string> = ar.enums.batchStatus;

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = ar.enums.auditAction;

const AUDIT_TARGET_LABELS: Record<string, string> = ar.enums.auditTarget;
const CASE_TYPE_LABELS: Record<string, string> = ar.enums.caseType;
const SHADE_LABELS: Record<string, string> = ar.enums.shade;

/**
 * Label for cases.case_type. New cases store the owner's Arabic work-type name, shown as is.
 * Legacy English values from before migration 005 (e.g. 'Crown') get their old Arabic label.
 */
export function caseTypeLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return CASE_TYPE_LABELS[value] ?? value;
}

/** Shade codes (A1, B2...) stay as codes; only named options are translated. */
export function shadeLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return SHADE_LABELS[value] ?? value;
}

export function auditTargetLabel(value: string | null | undefined): string {
  if (!value) return '—';
  return AUDIT_TARGET_LABELS[value] ?? value;
}

// Common shade systems
export const SHADE_OPTIONS = [
  'A1', 'A2', 'A3', 'A3.5', 'A4',
  'B1', 'B2', 'B3', 'B4',
  'C1', 'C2', 'C3', 'C4',
  'D2', 'D3', 'D4',
  'BL1', 'BL2', 'BL3', 'BL4',
  'Custom',
] as const;
