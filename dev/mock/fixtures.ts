/**
 * FAKE demo data for the dev-only preview (npm run dev:mock). No real patients.
 * Mixes Arabic and English names on purpose to check bidirectional text.
 */
import type {
  AuditLog,
  Case,
  CaseEvent,
  CaseStatus,
  DeliveryBatch,
  Dentist,
  Profile,
  WorkType,
} from '@/types/database';

const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
const dateOnly = (offsetDays: number) => new Date(now + offsetDays * 86_400_000).toISOString().slice(0, 10);

const profile = (id: string, full_name: string, email: string, role: Profile['role'], status: Profile['status'] = 'active', phone: string | null = null): Profile => ({
  id,
  email,
  full_name,
  role,
  status,
  phone,
  avatar_url: null,
  created_at: daysAgo(120),
  updated_at: daysAgo(3),
  deactivated_at: null,
});

export const PROFILES: Profile[] = [
  profile('u-owner', 'د. هالة منصور', 'owner@demo.test', 'owner', 'active', '+20 100 000 0001'),
  profile('u-recep', 'منة الله سامي', 'reception@demo.test', 'receptionist', 'active', '+20 100 000 0002'),
  profile('u-tech1', 'كريم عادل', 'karim.tech@demo.test', 'technician'),
  profile('u-tech2', 'Omar Haddad', 'omar.tech@demo.test', 'technician'),
  profile('u-rep', 'محمود الشريف', 'rep@demo.test', 'representative', 'active', '01000000005'),
  profile('u-old', 'Sara Ahmed', 'sara.old@demo.test', 'technician', 'inactive'),
  profile('u-new', 'ياسمين فؤاد', 'yasmin.new@demo.test', 'receptionist', 'pending_invitation'),
];

const dentist = (id: string, name: string, clinic_name: string | null, phone: string | null, email: string | null, address: string | null, is_active = true): Dentist => ({
  id,
  name,
  clinic_name,
  phone,
  email,
  address,
  notes: null,
  is_active,
  created_at: daysAgo(200),
  updated_at: daysAgo(10),
  created_by: 'u-owner',
});

export const DENTISTS: Dentist[] = [
  dentist('d1', 'د. منى السيد', 'عيادة النيل لطب الأسنان', '+20 122 000 1111', 'mona@nile-clinic.test', '15 شارع التحرير، الدقي، الجيزة'),
  dentist('d2', 'Dr. Sarah Clark', 'Apex Dental Arts', '+971 4 000 2222', 'sarah@apex.test', 'Dubai Healthcare City, Building 27'),
  dentist('d3', 'د. أحمد فاروق', null, '01011112222', null, null),
  dentist('d4', 'د. خالد ناصر', 'عيادة الشروق', null, null, 'مدينة نصر', false),
];

let counter = 0;
const caseRow = (
  status: CaseStatus,
  patient: string,
  dentistId: string | null,
  techId: string | null,
  extra: Partial<Case> = {},
): Case => {
  counter += 1;
  const d = DENTISTS.find((x) => x.id === dentistId) ?? null;
  const tech = PROFILES.find((p) => p.id === techId) ?? null;
  return {
    id: `c${counter}`,
    case_number: `CASE-202610-${String(counter).padStart(5, '0')}`,
    patient_name: patient,
    patient_age: 30 + counter,
    patient_dob: null,
    dentist_id: dentistId,
    dentist_name_text: null,
    clinic_name_text: null,
    case_type: 'Crown',
    tooth_number: '11',
    shade: 'A2',
    description: null,
    special_instructions: null,
    current_status: status,
    priority: 'normal',
    date_received: daysAgo(10 - counter / 2),
    due_date: dateOnly(5),
    completed_at: null,
    delivered_at: null,
    assigned_technician_id: techId,
    assigned_at: techId ? daysAgo(5) : null,
    intake_batch_id: null,
    return_batch_id: null,
    registered_by: 'u-recep',
    notes: null,
    created_at: daysAgo(14 - counter),
    updated_at: daysAgo(1),
    dentist: d ?? undefined,
    assigned_technician: tech ?? undefined,
    registered_by_profile: PROFILES[1],
    ...extra,
  } as Case;
};

export const CASES: Case[] = [
  caseRow('awaiting_assignment', 'محمد عبد الرحمن', 'd1', null, { case_type: 'Bridge', tooth_number: '21-23', shade: 'A3', priority: 'high' }),
  caseRow('awaiting_assignment', 'John Miller', 'd2', null, { case_type: 'Veneer', tooth_number: '11, 12, 21, 22', shade: 'BL2' }),
  caseRow('assigned', 'فاطمة الزهراء علي', 'd1', 'u-tech1', { case_type: 'Implant Crown', tooth_number: '36' }),
  caseRow('in_progress', 'Layla Hassan', 'd2', 'u-tech1', {
    case_type: 'Denture - Partial',
    tooth_number: null,
    shade: 'Custom',
    priority: 'urgent',
    due_date: dateOnly(-2),
    special_instructions: 'استخدم لون A2 في الثلث العنقي و A1 في الحافة القاطعة. Margin: chamfer 0.5mm.',
    description: 'طقم جزئي علوي — Cr-Co framework',
  }),
  caseRow('in_progress', 'يوسف إبراهيم', 'd3', 'u-tech2', { case_type: 'Night Guard', tooth_number: null, shade: null }),
  caseRow('on_hold', 'سلمى خالد', 'd1', 'u-tech1', { case_type: 'Post and Core', tooth_number: '45' }),
  caseRow('completed', 'Ahmed Saeed', 'd2', 'u-tech2', { case_type: 'Crown', tooth_number: '16' }),
  caseRow('awaiting_reception_receipt', 'نور الهدى', 'd1', 'u-tech1', { case_type: 'Maryland Bridge', tooth_number: '12-22' }),
  caseRow('received_by_reception', 'عمرو دياب', 'd3', 'u-tech2', { case_type: 'Inlay', tooth_number: '26' }),
  caseRow('awaiting_representative_pickup', 'Mariam Fathy', 'd2', 'u-tech1', { case_type: 'Onlay', tooth_number: '37' }),
  caseRow('with_representative', 'حسن مصطفى', 'd1', 'u-tech2', { case_type: 'Crown', tooth_number: '14' }),
  caseRow('delivered', 'رنا وليد', 'd1', 'u-tech1', { case_type: 'Retainer', tooth_number: null, delivered_at: daysAgo(1) }),
  caseRow('rework_required', 'Tarek Nabil', 'd2', 'u-tech2', { case_type: 'Bridge', tooth_number: '44-46', priority: 'high' }),
  caseRow('cancelled', 'هبة سمير', 'd3', null, { case_type: 'Other', tooth_number: null, priority: 'low' }),
  caseRow('registered', 'Khaled Youssef', null, null, { dentist_name_text: 'د. إيهاب (عيادة خارجية)', case_type: 'Temporary Crown' }),
];

export const EVENTS: CaseEvent[] = [
  { id: 'e1', case_id: 'c4', event_type: 'created', previous_status: null, new_status: null, actor_id: 'u-recep', sender_id: null, receiver_id: null, notes: null, metadata: {}, batch_id: null, assignment_id: null, created_at: daysAgo(9) },
  { id: 'e2', case_id: 'c4', event_type: 'assigned', previous_status: 'awaiting_assignment', new_status: 'assigned', actor_id: 'u-recep', sender_id: null, receiver_id: null, notes: null, metadata: {}, batch_id: null, assignment_id: 'u-tech1', created_at: daysAgo(6) },
  { id: 'e3', case_id: 'c4', event_type: 'work_started', previous_status: 'assigned', new_status: 'in_progress', actor_id: 'u-tech1', sender_id: null, receiver_id: null, notes: 'بدأ الفني العمل على الحالة', metadata: {}, batch_id: null, assignment_id: null, created_at: daysAgo(2) },
  { id: 'e4', case_id: 'c4', event_type: 'note_added', previous_status: null, new_status: null, actor_id: 'u-owner', sender_id: null, receiver_id: null, notes: 'الطبيبة طلبت التسليم قبل يوم الخميس. Shade confirmed: A2.', metadata: {}, batch_id: null, assignment_id: null, created_at: new Date(now - 40 * 60_000).toISOString() },
].map((e) => ({ ...e, actor: PROFILES.find((p) => p.id === e.actor_id) })) as CaseEvent[];

export const BATCHES: DeliveryBatch[] = [
  { id: 'b1', batch_reference: 'BATCH-202610-INT-001', batch_type: 'intake', status: 'open', representative_id: 'u-rep', receptionist_id: null, expected_count: 5, actual_count: 3, handoff_at: daysAgo(1), confirmed_at: null, notes: 'استلام من عيادة النيل — صندوقين', discrepancy_notes: null, created_at: daysAgo(1), updated_at: daysAgo(1) },
  { id: 'b2', batch_reference: 'BATCH-202610-RET-002', batch_type: 'return', status: 'closed', representative_id: 'u-rep', receptionist_id: 'u-recep', expected_count: 2, actual_count: 2, handoff_at: daysAgo(4), confirmed_at: daysAgo(4), notes: null, discrepancy_notes: null, created_at: daysAgo(4), updated_at: daysAgo(4) },
  { id: 'b3', batch_reference: 'BATCH-202610-INT-003', batch_type: 'intake', status: 'discrepancy', representative_id: null, receptionist_id: 'u-recep', expected_count: 4, actual_count: 3, handoff_at: daysAgo(7), confirmed_at: daysAgo(7), notes: null, discrepancy_notes: 'العدد غير متطابق', created_at: daysAgo(7), updated_at: daysAgo(7) },
].map((b) => ({
  ...b,
  representative: PROFILES.find((p) => p.id === b.representative_id),
  receptionist: PROFILES.find((p) => p.id === b.receptionist_id),
})) as DeliveryBatch[];

/** Starts EMPTY on purpose: the lab owner enters the real work types (أنواع الشغل). */
export const WORK_TYPES: WorkType[] = [];

export const BATCH_CASES = [
  { id: 'bc1', batch_id: 'b1', case_id: 'c1', added_at: daysAgo(1), added_by: 'u-recep' },
  { id: 'bc2', batch_id: 'b1', case_id: 'c2', added_at: daysAgo(1), added_by: 'u-recep' },
  { id: 'bc3', batch_id: 'b1', case_id: 'c15', added_at: daysAgo(1), added_by: 'u-recep' },
];

export const AUDIT_LOGS: AuditLog[] = [
  { id: 'a1', action: 'user_created', actor_id: 'u-owner', target_id: '6f1c2a90-1111-4b8e-9d1a-000000000001', target_type: 'user', details: { email: 'yasmin.new@demo.test', role: 'receptionist' }, ip_address: '197.45.10.20', user_agent: null, created_at: daysAgo(2) },
  { id: 'a2', action: 'user_deactivated', actor_id: 'u-owner', target_id: '6f1c2a90-2222-4b8e-9d1a-000000000002', target_type: 'user', details: { reason: 'ترك العمل', reassigned_case_count: 2 }, ip_address: null, user_agent: null, created_at: daysAgo(5) },
  { id: 'a3', action: 'system_event', actor_id: null, target_id: null, target_type: 'settings', details: {}, ip_address: null, user_agent: null, created_at: daysAgo(9) },
].map((l) => ({ ...l, actor: PROFILES.find((p) => p.id === l.actor_id) })) as AuditLog[];
