/**
 * Phone layout of the list pages and dashboards: below `md` each row is a card in a
 * labelled ul/li (role="list", kept by iOS VoiceOver) with the same data and actions
 * (44px tap targets); from `md` up the table is kept inside a `hidden md:block` wrapper.
 * jsdom applies no CSS, so both layouts are in the DOM and are checked by markup and
 * classes. Hooks are mocked; one shared mutateAsync records what the actions send.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ar } from '@/i18n/ar';
import { t } from '@/i18n';
import type { AppRole, AuditLog, Case, DeliveryBatch, Dentist, Profile, WorkType } from '@/types/database';
import { TechnicianDashboard } from '@/pages/TechnicianDashboard';
import { RepresentativeDashboard } from '@/pages/RepresentativeDashboard';
import { ReceptionDashboard } from '@/pages/ReceptionDashboard';
import { BatchesPage } from '@/pages/BatchesPage';
import { DentistsPage } from '@/pages/DentistsPage';
import { EmployeesPage } from '@/pages/EmployeesPage';
import { WorkTypesPage } from '@/pages/WorkTypesPage';
import { AuditLogsPage } from '@/pages/AuditLogsPage';

// ---- fixtures ----------------------------------------------------------------

const apex = {
  id: 'd2', name: 'Dr. Sarah Clark', clinic_name: 'Apex Dental Arts', phone: '+971 4 000 2222',
  email: 'sarah.clark.long.address@apex-dental-arts.test', address: 'Dubai Healthcare City, Building 27',
  notes: null, is_active: true, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-01T08:00:00Z', created_by: null,
} satisfies Dentist;
const noor = { ...apex, id: 'd1', name: 'د. أحمد', clinic_name: 'عيادة النور', phone: '01001234567', email: null, address: null, is_active: false };

const tech = {
  id: 'u-tech', email: 'tech@example.test', full_name: 'فني أول', role: 'technician', status: 'active',
  phone: '01111111111', avatar_url: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deactivated_at: null,
} satisfies Profile;
const owner = { ...tech, id: 'u-owner', email: 'owner@example.test', full_name: 'المالك', role: 'owner', phone: null } satisfies Profile;
const rep = { ...tech, id: 'u-rep', email: 'rep@example.test', full_name: 'مندوب', role: 'representative' } satisfies Profile;

const caseBase = {
  patient_age: 30, patient_dob: null, dentist_id: 'd2', dentist_name_text: null, clinic_name_text: null,
  case_type: 'جهاز متحرك', upper_jaw: true, lower_jaw: null, tooth_number: null, shade: null, description: null,
  special_instructions: null, priority: 'normal', date_received: '2026-10-01', due_date: '2026-12-01',
  completed_at: null, delivered_at: null, assigned_technician_id: 'u-tech', assigned_at: null, intake_batch_id: null,
  return_batch_id: null, registered_by: null, notes: null, created_at: '2026-10-01T08:00:00Z',
  updated_at: '2026-10-01T08:00:00Z', dentist: apex, assigned_technician: tech,
} satisfies Partial<Case>;

const num = (n: number) => `CASE-202610-${String(n).padStart(5, '0')}`;
const mk = (id: string, n: number, current_status: Case['current_status'], extra: Partial<Case> = {}) =>
  ({ ...caseBase, id, case_number: num(n), patient_name: `مريض ${n}`, current_status, ...extra }) as Case;

const cases: Case[] = [
  mk('c1', 1, 'assigned'),
  mk('c2', 2, 'in_progress', { due_date: '2026-01-01' }),
  mk('c3', 3, 'in_progress', { dentist: noor }),
  mk('c4', 4, 'completed'),
  mk('c5', 5, 'awaiting_assignment', { assigned_technician_id: null, assigned_technician: undefined }),
  mk('c6', 6, 'awaiting_reception_receipt'),
  mk('c7', 7, 'received_by_reception'),
  mk('c8', 8, 'awaiting_representative_pickup'),
  mk('c9', 9, 'with_representative'),
  // no dentist record and no free-text clinic / doctor
  mk('c10', 10, 'with_representative', { dentist_id: null, dentist: undefined }),
];

const batches = [
  {
    id: 'b1', batch_reference: 'BATCH-000111', batch_type: 'intake', status: 'open', representative_id: 'u-rep',
    receptionist_id: null, expected_count: 3, actual_count: 2, handoff_at: '2026-10-20T08:00:00Z', confirmed_at: null,
    notes: null, discrepancy_notes: null, created_at: '2026-10-20T08:00:00Z', updated_at: '2026-10-20T08:00:00Z',
    representative: rep,
  },
  {
    id: 'b2', batch_reference: 'BATCH-000222', batch_type: 'return', status: 'discrepancy', representative_id: null,
    receptionist_id: null, expected_count: 5, actual_count: 4, handoff_at: '2026-10-21T08:00:00Z', confirmed_at: null,
    notes: null, discrepancy_notes: null, created_at: '2026-10-21T08:00:00Z', updated_at: '2026-10-21T08:00:00Z',
  },
] satisfies DeliveryBatch[];

const workTypes = [
  { id: 'w1', name: 'جهاز متحرك', is_active: true, sort_order: 0, created_at: '2026-01-01' },
  { id: 'w2', name: 'مثبت', is_active: false, sort_order: 1, created_at: '2026-01-01' },
] satisfies WorkType[];

const logs = [
  {
    id: 'l1', action: 'settings_changed', actor_id: 'u-owner', target_id: 'abcdef1234567890', target_type: 'work_type',
    details: { name: 'x' }, ip_address: '10.0.0.1', user_agent: null, created_at: '2026-10-22T08:00:00Z', actor: owner,
  },
] satisfies AuditLog[];

// ---- mocks -------------------------------------------------------------------

const { auth, useCases, mutateAsync } = vi.hoisted(() => ({
  auth: { role: 'owner' as AppRole },
  useCases: vi.fn(),
  mutateAsync: vi.fn(),
}));

const mutation = () => ({ mutateAsync, mutate: vi.fn(), isPending: false });

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    profile: { owner, technician: tech, representative: rep, receptionist: { ...owner, id: 'u-rec', role: 'receptionist' } }[auth.role],
  }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useSupabase', () => ({
  useCases,
  useUpdateCaseStatus: () => mutation(),
  useAssignTechnician: () => mutation(),
  useTechnicians: () => ({ data: [tech] }),
  useBatches: () => ({ data: { data: batches, count: 40 }, isLoading: false, refetch: vi.fn() }),
  useCreateBatch: () => mutation(),
  useUpdateBatch: () => mutation(),
  useBatchCases: () => ({ data: [], isLoading: false }),
  useAddCaseToBatch: () => mutation(),
  useRepresentatives: () => ({ data: [rep] }),
  useAllDentists: () => ({ data: [apex, noor], isLoading: false, refetch: vi.fn() }),
  useCreateDentist: () => mutation(),
  useUpdateDentist: () => mutation(),
  useProfiles: () => ({ data: [owner, tech, rep], isLoading: false, refetch: vi.fn() }),
  useUpdateProfile: () => mutation(),
  useCreateEmployee: () => mutation(),
  useGetOutstandingWork: () => ({ data: undefined, isLoading: false }),
  useReassignAndDeactivateTechnician: () => mutation(),
  useResetUserPassword: () => mutation(),
  useWorkTypes: () => ({ data: workTypes, isLoading: false }),
  useCreateWorkType: () => mutation(),
  useUpdateWorkType: () => mutation(),
  useAuditLogs: () => ({ data: { data: logs, count: 1 }, isLoading: false }),
  useLateCaseCounts: () => ({ data: { late_count: 0, today_count: 0 }, isLoading: false, isError: false }),
}));

useCases.mockImplementation((filters: { status?: string } = {}) => ({
  data: {
    data: filters.status ? cases.filter((c) => c.current_status === filters.status) : cases,
    count: cases.length,
  },
  isLoading: false,
  refetch: vi.fn(),
}));

function renderAs(role: AppRole, page: React.ReactElement) {
  auth.role = role;
  return render(<MemoryRouter>{page}</MemoryRouter>);
}

afterEach(() => {
  cleanup();
  mutateAsync.mockReset();
});

// ---- helpers -----------------------------------------------------------------

/** The phone list with this accessible name: explicit list role, hidden from md up, one item per row. */
function mobileItems(name: string, count: number) {
  const list = screen.getByRole('list', { name });
  expect(list).toHaveAttribute('role', 'list');
  expect(list).toHaveClass('md:hidden');
  const items = within(list).getAllByRole('listitem');
  expect(items).toHaveLength(count);
  return items;
}

/** Every table on the page is inside the md-and-up wrapper, with no button nested in a link. */
function expectTablesDesktopOnly(count: number) {
  const tables = screen.getAllByRole('table');
  expect(tables).toHaveLength(count);
  for (const table of tables) {
    expect(table.closest('.hidden.md\\:block')).not.toBeNull();
    expect(table.querySelector('a button, button a')).toBeNull();
  }
}

/** 44px: on the element itself, or from the card action row (`*:min-h-11` on its parent). */
function expectTouch(el: HTMLElement) {
  const own = el.classList.contains('min-h-11');
  const fromRow = el.parentElement?.classList.contains('*:min-h-11') ?? false;
  expect(own || fromRow, `44px tap target on: ${el.outerHTML.slice(0, 120)}`).toBe(true);
}

/** A text button in a card: tappable and no redundant `title`. */
function expectLabelledTouch(el: HTMLElement) {
  expectTouch(el);
  expect(el).not.toHaveAttribute('title');
}

// ---- tests -------------------------------------------------------------------

describe('TechnicianDashboard on phones', () => {
  it('lists the cases of the current tab as cards with reachable actions', () => {
    renderAs('technician', <TechnicianDashboard />);
    const [first, second] = mobileItems(ar.dashboards.technician.queueTitle, 2);

    expect(within(first).getByRole('link', { name: num(2) })).toHaveAttribute('href', '/cases/c2');
    for (const text of ['مريض 2', 'Dr. Sarah Clark', 'جهاز متحرك', ar.enums.jaw.upper, ar.enums.priority.normal, ar.enums.caseStatus.in_progress, t('common.labels.overdue')]) {
      expect(first).toHaveTextContent(text);
    }
    expect(second).not.toHaveTextContent(t('common.labels.overdue'));

    expectLabelledTouch(within(first).getByRole('button', { name: ar.dashboards.technician.complete }));
    expectLabelledTouch(within(first).getByRole('button', { name: ar.dashboards.technician.putOnHold }));
    expectTouch(within(first).getByRole('link', { name: t('common.actions.viewDetails') }));
    expectTablesDesktopOnly(1);
  });

  it('tabs are 44px on phones and expose which one is selected', () => {
    renderAs('technician', <TechnicianDashboard />);
    const inProgress = screen.getByRole('button', { name: t('dashboards.technician.tabs.inProgress', { count: 2 }) });
    const all = screen.getByRole('button', { name: t('dashboards.technician.tabs.all', { count: cases.length }) });
    expect(inProgress).toHaveAttribute('aria-pressed', 'true');
    expect(all).toHaveAttribute('aria-pressed', 'false');
    expect(all).toHaveClass('min-h-11', 'md:min-h-0');
    fireEvent.click(all);
    expect(all).toHaveAttribute('aria-pressed', 'true');
    expect(inProgress).toHaveAttribute('aria-pressed', 'false');
  });

  it('shows start / submit actions on the "all" tab; submit opens the dialog for that case', () => {
    renderAs('technician', <TechnicianDashboard />);
    fireEvent.click(screen.getByRole('button', { name: t('dashboards.technician.tabs.all', { count: cases.length }) }));
    const items = mobileItems(ar.dashboards.technician.queueTitle, cases.length);
    expectLabelledTouch(within(items[0]).getByRole('button', { name: ar.dashboards.technician.startWork }));
    const submit = within(items[3]).getByRole('button', { name: ar.dashboards.technician.submitToReception });
    expectLabelledTouch(submit);
    fireEvent.click(submit);
    expect(screen.getByRole('dialog')).toHaveTextContent(num(4));
  });

  it('start work sends the status change for that case', () => {
    renderAs('technician', <TechnicianDashboard />);
    fireEvent.click(screen.getByRole('button', { name: t('dashboards.technician.tabs.all', { count: cases.length }) }));
    const [assigned] = mobileItems(ar.dashboards.technician.queueTitle, cases.length);
    fireEvent.click(within(assigned).getByRole('button', { name: ar.dashboards.technician.startWork }));
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'c1', newStatus: 'in_progress' }));
  });
});

describe('RepresentativeDashboard on phones', () => {
  it('in-transit cards: 44px case link, delivery dialog for the right case', () => {
    renderAs('representative', <RepresentativeDashboard />);

    const [transit, noDentist] = mobileItems(t('dashboards.representative.sections.inTransit', { count: 2 }), 2);
    const link = within(transit).getByRole('link', { name: num(9) });
    expect(link).toHaveAttribute('href', '/cases/c9');
    expect(link).toHaveClass('inline-flex', 'min-h-11', 'items-center');
    expect(transit).toHaveTextContent('Dubai Healthcare City, Building 27');

    // Missing clinic / doctor: the value is a dash, not the placeholder words العيادة / الطبيب
    const destination = within(noDentist).getByText(ar.dashboards.representative.columns.destination).nextElementSibling;
    expect(destination?.textContent).toBe('—');

    const deliver = within(transit).getByRole('button', { name: ar.dashboards.representative.markDelivered });
    expectLabelledTouch(deliver);
    fireEvent.click(deliver);
    expect(screen.getByRole('dialog')).toHaveTextContent(num(9));
    expectTablesDesktopOnly(2);
  });

  it('pickup card sends { caseId: c8, newStatus: with_representative }', () => {
    renderAs('representative', <RepresentativeDashboard />);
    const [pickup] = mobileItems(t('dashboards.representative.sections.readyForPickup', { count: 1 }), 1);
    expect(within(pickup).getByRole('link', { name: num(8) })).toHaveClass('min-h-11');

    const button = within(pickup).getByRole('button', { name: ar.dashboards.representative.pickUp });
    expectLabelledTouch(button);
    fireEvent.click(button);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'c8', newStatus: 'with_representative' }));
  });

  it('shows clinic and doctor as separate direction-isolated lines, never "clinic (doctor)"', () => {
    renderAs('representative', <RepresentativeDashboard />);
    expect(ar.dashboards.representative).not.toHaveProperty('clinicWithDentist');

    const doctors = screen.getAllByText('Dr. Sarah Clark');
    const clinics = screen.getAllByText('Apex Dental Arts');
    // c9 (in transit) + c8 (pickup), each in the card and the table
    expect(doctors).toHaveLength(4);
    expect(clinics).toHaveLength(4);
    for (const el of [...doctors, ...clinics]) {
      expect(el.tagName).toBe('BDI');
      // Its own line: the parent holds only this name, no parentheses around it.
      expect(el.parentElement!.textContent).toBe(el.textContent);
    }
    expect(document.body.textContent).not.toMatch(/Apex Dental Arts\s*\(/);
  });
});

describe('ReceptionDashboard on phones', () => {
  it('three card lists; 44px case links; assign opens the dialog for that case', () => {
    renderAs('receptionist', <ReceptionDashboard />);

    const [assign] = mobileItems(t('dashboards.reception.sections.awaitingAssignment', { count: 1 }), 1);
    expect(assign).toHaveTextContent('جهاز متحرك');
    const [receipt] = mobileItems(t('dashboards.reception.sections.awaitingReceipt', { count: 1 }), 1);
    expect(receipt).toHaveTextContent('فني أول');
    const [ready] = mobileItems(t('dashboards.reception.sections.inReception', { count: 1 }), 1);
    expect(ready).toHaveTextContent(ar.enums.caseStatus.received_by_reception);

    for (const [item, n] of [[assign, 5], [receipt, 6], [ready, 7]] as const) {
      const link = within(item).getByRole('link', { name: num(n) });
      expect(link).toHaveClass('inline-flex', 'min-h-11', 'items-center');
    }

    const assignBtn = within(assign).getByRole('button', { name: ar.dashboards.reception.assignTech });
    expectLabelledTouch(assignBtn);
    expectTablesDesktopOnly(3);
    fireEvent.click(assignBtn);
    expect(screen.getByRole('dialog')).toHaveTextContent(num(5));
  });

  it('receive sends c6 → received_by_reception', () => {
    renderAs('receptionist', <ReceptionDashboard />);
    const [receipt] = mobileItems(t('dashboards.reception.sections.awaitingReceipt', { count: 1 }), 1);
    const button = within(receipt).getByRole('button', { name: ar.dashboards.reception.receive });
    expectLabelledTouch(button);
    fireEvent.click(button);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'c6', newStatus: 'received_by_reception' }));
  });

  it('stage sends c7 → awaiting_representative_pickup', () => {
    renderAs('receptionist', <ReceptionDashboard />);
    const [ready] = mobileItems(t('dashboards.reception.sections.inReception', { count: 1 }), 1);
    const button = within(ready).getByRole('button', { name: ar.dashboards.reception.stage });
    expectLabelledTouch(button);
    fireEvent.click(button);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ caseId: 'c7', newStatus: 'awaiting_representative_pickup' }));
  });
});

describe('BatchesPage on phones', () => {
  it('one card per batch with counts, status and a 44px manage button; pagination shared', () => {
    renderAs('receptionist', <BatchesPage />);
    const [open, discrepancy] = mobileItems(ar.batches.title, 2);

    expect(open).toHaveTextContent('BATCH-000111');
    expect(open).toHaveTextContent('مندوب');
    expect(open).toHaveTextContent(ar.enums.batchStatus.open);
    expect(discrepancy).toHaveTextContent(t('common.labels.unassigned'));
    expect(discrepancy).toHaveTextContent(ar.enums.batchStatus.discrepancy);

    const manage = within(open).getByRole('button', { name: ar.batches.manageCases });
    expectLabelledTouch(manage);
    expectTablesDesktopOnly(1);
    expect(screen.getAllByRole('navigation')).toHaveLength(1);

    fireEvent.click(manage);
    expect(screen.getByRole('dialog')).toHaveTextContent('BATCH-000111');
  });
});

describe('DentistsPage on phones', () => {
  it('one card per dentist with contact details and 44px actions', () => {
    renderAs('receptionist', <DentistsPage />);
    const [first, second] = mobileItems(ar.dentists.title, 2);

    for (const text of ['Dr. Sarah Clark', 'Apex Dental Arts', '+971 4 000 2222', 'Dubai Healthcare City, Building 27']) {
      expect(first).toHaveTextContent(text);
    }
    expect(second).toHaveTextContent(t('common.labels.inactive'));

    expectLabelledTouch(within(first).getByRole('button', { name: ar.dentists.editDetails }));
    expectLabelledTouch(within(first).getByRole('button', { name: t('common.actions.deactivate') }));
    expectLabelledTouch(within(second).getByRole('button', { name: t('common.actions.activate') }));
    expectTablesDesktopOnly(1);
  });

  it.each(['technician', 'representative'] as const)('%s sees no edit / activate / deactivate in the cards', (role) => {
    renderAs(role, <DentistsPage />);
    for (const item of mobileItems(ar.dentists.title, 2)) {
      for (const name of [ar.dentists.editDetails, t('common.actions.deactivate'), t('common.actions.activate')]) {
        expect(within(item).queryByRole('button', { name })).toBeNull();
      }
    }
  });

  it('never wraps phone numbers; long emails may break on phones only', () => {
    renderAs('receptionist', <DentistsPage />);
    const phones = screen.getAllByText('+971 4 000 2222');
    expect(phones).toHaveLength(2);
    for (const el of phones) expect(el).toHaveClass('whitespace-nowrap');
    const emails = screen.getAllByText(apex.email);
    expect(emails).toHaveLength(2);
    for (const el of emails) expect(el).toHaveClass('break-all', 'md:break-normal');
  });
});

describe('EmployeesPage on phones', () => {
  it('one card per employee with role, status and 44px actions', () => {
    renderAs('owner', <EmployeesPage />);
    const [ownerItem, techItem] = mobileItems(ar.employees.title, 3);

    expect(ownerItem).toHaveTextContent('owner@example.test');
    expect(ownerItem).toHaveTextContent(ar.enums.role.owner);
    // the owner cannot deactivate themself
    expect(within(ownerItem).queryByRole('button', { name: t('common.actions.deactivate') })).toBeNull();

    expect(techItem).toHaveTextContent('01111111111');
    expectLabelledTouch(within(techItem).getByRole('button', { name: ar.employees.resetPassword }));
    expectLabelledTouch(within(techItem).getByRole('button', { name: ar.employees.editRoleStatus }));
    expectLabelledTouch(within(techItem).getByRole('button', { name: t('common.actions.deactivate') }));
    expectTablesDesktopOnly(1);
  });
});

describe('WorkTypesPage on phones', () => {
  it('one card per type with 44px move / rename / toggle buttons', () => {
    renderAs('owner', <WorkTypesPage />);
    const [active, inactive] = mobileItems(ar.workTypes.title, 2);

    expect(active).toHaveTextContent('جهاز متحرك');
    expect(inactive).toHaveTextContent(t('common.labels.inactive'));
    expect(within(active).getByRole('button', { name: ar.workTypes.moveUp })).toBeDisabled();
    expectTouch(within(active).getByRole('button', { name: ar.workTypes.moveDown }));
    expectLabelledTouch(within(active).getByRole('button', { name: ar.workTypes.rename }));
    expectLabelledTouch(within(active).getByRole('button', { name: t('common.actions.deactivate') }));
    expectLabelledTouch(within(inactive).getByRole('button', { name: t('common.actions.activate') }));
    expectTablesDesktopOnly(1);
  });
});

describe('AuditLogsPage on phones', () => {
  it('one card per log entry with action, actor, target and network', () => {
    renderAs('owner', <AuditLogsPage />);
    const [entry] = mobileItems(ar.audit.title, 1);

    for (const text of [ar.enums.auditAction.settings_changed, 'المالك', 'owner@example.test', 'abcdef12', '10.0.0.1']) {
      expect(entry).toHaveTextContent(text);
    }
    expectTablesDesktopOnly(1);
  });
});
