/**
 * Cases page layout: a card list below `md` (phones) and the table from `md` up, both
 * built from the same useCases() page. Filters, search and pagination are shared.
 * CSS breakpoints are not applied in jsdom, so both layouts are checked by markup/classes.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ar } from '@/i18n/ar';
import { t } from '@/i18n';
import { CasesPage } from '@/pages/CasesPage';
import type { Case } from '@/types/database';

const { useCases, auth } = vi.hoisted(() => ({ useCases: vi.fn(), auth: { role: 'owner' } }));

vi.mock('@/hooks/useSupabase', () => ({
  useCases,
  useTechnicians: () => ({
    data: [{ id: 't1', full_name: 'فني أول', email: 'tech@example.com', role: 'technician', status: 'active' }],
  }),
  useAssignTechnician: () => ({ mutateAsync: vi.fn() }),
  useUpdateCaseStatus: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: `u-${auth.role}`, role: auth.role } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const base = {
  patient_dob: null, dentist_id: null, dentist_name_text: null, clinic_name_text: null,
  upper_jaw: null, lower_jaw: null, tooth_number: null, shade: null, description: null,
  special_instructions: null, date_received: '2026-10-01', completed_at: null, delivered_at: null,
  assigned_technician_id: null, assigned_at: null, intake_batch_id: null, return_batch_id: null,
  registered_by: null, notes: null, created_at: '2026-10-01T08:00:00Z', updated_at: '2026-10-01T08:00:00Z',
} satisfies Partial<Case>;

const cases = [
  {
    ...base, id: 'c1', case_number: 'CASE-202610-00001', patient_name: 'مريض أول', patient_age: 34,
    case_type: 'جهاز متحرك', upper_jaw: true, lower_jaw: false, current_status: 'in_progress',
    priority: 'urgent', due_date: '2026-01-05', assigned_technician_id: 't1',
    dentist: { id: 'd1', name: 'د. أحمد', clinic_name: 'عيادة النور' },
    assigned_technician: { id: 't1', full_name: 'فني أول' },
  },
  {
    ...base, id: 'c2', case_number: 'CASE-202610-00002', patient_name: 'مريض ثان', patient_age: null,
    case_type: 'Crown', shade: 'A2', current_status: 'awaiting_assignment', priority: 'normal',
    due_date: null, dentist_name_text: 'د. سامي',
  },
] as unknown as Case[];

function renderPage() {
  useCases.mockReturnValue({ data: { data: cases, count: 40 }, isLoading: false, refetch: vi.fn() });
  return render(
    <MemoryRouter>
      <CasesPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  useCases.mockReset();
  auth.role = 'owner';
});

/** 44px: on the element itself, or from the card action row (`*:min-h-11` on its parent). */
function expectTouch(el: HTMLElement) {
  const own = el.classList.contains('min-h-11');
  const fromRow = el.parentElement?.classList.contains('*:min-h-11') ?? false;
  expect(own || fromRow).toBe(true);
}

describe('CasesPage mobile card list', () => {
  it('renders one list item per case, named by the page title and hidden from md up', () => {
    renderPage();
    const list = screen.getByRole('list', { name: ar.cases.list.title });
    expect(list).toHaveAttribute('role', 'list');
    expect(list).toHaveClass('md:hidden');
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows the key fields of each case', () => {
    renderPage();
    const [first, second] = within(screen.getByRole('list', { name: ar.cases.list.title })).getAllByRole('listitem');

    expect(within(first).getByRole('link', { name: 'CASE-202610-00001' })).toHaveAttribute('href', '/cases/c1');
    for (const text of [
      'مريض أول', t('common.labels.age', { value: 34 }), 'د. أحمد', 'عيادة النور', 'جهاز متحرك',
      ar.enums.jaw.upper, ar.enums.caseStatus.in_progress, ar.enums.priority.urgent, 'فني أول',
      t('common.labels.overdue'),
    ]) {
      expect(first).toHaveTextContent(text);
    }

    expect(second).toHaveTextContent('د. سامي');
    expect(second).toHaveTextContent(t('common.labels.unassigned'));
    expect(second).toHaveTextContent(ar.cases.legacySpecs.label);
    expect(second).not.toHaveTextContent(t('common.labels.overdue'));
  });

  it('has 44px actions that open the same dialogs as the table', () => {
    renderPage();
    const [first] = within(screen.getByRole('list', { name: ar.cases.list.title })).getAllByRole('listitem');

    const view = within(first).getByRole('link', { name: t('common.actions.viewDetails') });
    expect(view).toHaveAttribute('href', '/cases/c1');
    expectTouch(view);

    const assign = within(first).getByRole('button', { name: ar.cases.list.assignTechnician });
    expectTouch(assign);
    expect(assign).not.toHaveAttribute('title');
    fireEvent.click(assign);
    expect(screen.getByRole('dialog')).toHaveTextContent('CASE-202610-00001');
  });

  it.each(['technician', 'representative'])('%s gets no assign button in a card', (role) => {
    auth.role = role;
    renderPage();
    for (const item of within(screen.getByRole('list', { name: ar.cases.list.title })).getAllByRole('listitem')) {
      expect(within(item).queryByRole('button', { name: ar.cases.list.assignTechnician })).toBeNull();
      // still able to open the case
      expect(within(item).getByRole('link', { name: t('common.actions.viewDetails') })).toBeInTheDocument();
    }
  });
});

describe('CasesPage table (md and up) and shared controls', () => {
  it('keeps the table, hidden below md, with one row per case', () => {
    renderPage();
    const table = screen.getByRole('table');
    expect(table.closest('.hidden.md\\:block')).not.toBeNull();
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('table actions are single interactive elements (no button inside a link)', () => {
    renderPage();
    const table = screen.getByRole('table');
    expect(table.querySelector('a button, button a')).toBeNull();
    const views = within(table).getAllByRole('link', { name: t('common.actions.viewDetails') });
    expect(views.map((a) => a.getAttribute('href'))).toEqual(['/cases/c1', '/cases/c2']);
    expect(document.querySelector('a button, button a')).toBeNull();
  });

  it('has one pagination shared by both layouts', () => {
    renderPage();
    const navs = screen.getAllByRole('navigation');
    expect(navs).toHaveLength(1);
    fireEvent.click(within(navs[0]).getByRole('button', { name: ar.common.pagination.next }));
    expect(useCases).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
  });
});
