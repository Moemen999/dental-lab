/**
 * Late cases page layout: a card list below `md` (phones) and a table from `md` up,
 * both built from the same useLateCases() rows. CSS breakpoints are not applied in
 * jsdom, so both layouts are in the DOM and checked by their markup and classes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ar } from '@/i18n/ar';
import { t } from '@/i18n';
import { CaseNumber } from '@/components/ui/Bidi';
import { LateCasesPage } from '@/pages/LateCasesPage';
import type { LateCase } from '@/types/database';

const { useLateCases } = vi.hoisted(() => ({ useLateCases: vi.fn() }));
vi.mock('@/hooks/useSupabase', () => ({ useLateCases }));

const L = ar.lateCases;

const rows: LateCase[] = [
  {
    id: 'c1', case_number: 'CASE-202610-00004', patient_name: 'مريض أول',
    due_date: '2026-10-20', current_status: 'in_progress', technician_name: 'فني أول',
    dentist_name: 'د. أحمد', dentist_phone: '01001234567', bucket: 'late',
  },
  {
    id: 'c2', case_number: 'CASE-202610-00005', patient_name: 'مريض ثان',
    due_date: '2026-10-21', current_status: 'assigned', technician_name: null,
    dentist_name: 'د. سامي', dentist_phone: '0223456789', bucket: 'late',
  },
  {
    id: 'c3', case_number: 'CASE-202610-00006', patient_name: 'مريض ثالث',
    due_date: '2026-10-22', current_status: 'completed', technician_name: 'فني ثان',
    dentist_name: null, dentist_phone: null, bucket: 'today',
  },
];

function renderPage() {
  useLateCases.mockReturnValue({ data: rows, isLoading: false, error: null });
  return render(
    <MemoryRouter>
      <LateCasesPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  useLateCases.mockReset();
});

describe('LateCasesPage mobile card list', () => {
  it('renders one list item per case in each section, hidden from md up', () => {
    renderPage();
    const lists = screen.getAllByRole('list');
    expect(lists).toHaveLength(2);
    for (const list of lists) {
      expect(list).toHaveAttribute('role', 'list');
      expect(list).toHaveClass('md:hidden');
    }

    const [lateList, todayList] = lists;
    expect(lateList).toHaveAccessibleName(t('lateCases.sections.late', { count: 2 }));
    expect(todayList).toHaveAccessibleName(t('lateCases.sections.today', { count: 1 }));
    expect(within(lateList).getAllByRole('listitem')).toHaveLength(2);
    expect(within(todayList).getAllByRole('listitem')).toHaveLength(1);
  });

  it('shows every field, then the WhatsApp link (44px tap target) or the phone warning', () => {
    renderPage();
    const [lateList, todayList] = screen.getAllByRole('list');
    const [mobileItem, landlineItem] = within(lateList).getAllByRole('listitem');

    expect(mobileItem).toHaveTextContent('CASE-202610-00004');
    expect(mobileItem).toHaveTextContent('مريض أول');
    expect(mobileItem).toHaveTextContent('د. أحمد');
    expect(mobileItem).toHaveTextContent('فني أول');
    for (const label of [L.columns.patient, L.columns.doctor, L.columns.technician, L.columns.dueDate, L.columns.status]) {
      expect(mobileItem).toHaveTextContent(label);
    }
    expect(mobileItem).toHaveTextContent(ar.enums.caseStatus.in_progress);

    const wa = within(mobileItem).getByRole('link', {
      name: t('lateCases.whatsappAria', { caseNumber: 'CASE-202610-00004' }),
    });
    expect(wa.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/201001234567\?text=/);
    // 44px from the card action row (`*:min-h-11` on the direct parent)
    expect(wa.parentElement).toHaveClass('*:min-h-11');
    const view = within(mobileItem).getByRole('link', { name: L.viewCase });
    expect(view).toHaveAttribute('href', '/cases/c1');
    expect(view.parentElement).toHaveClass('*:min-h-11');

    expect(landlineItem).toHaveTextContent(L.unassigned);
    expect(within(landlineItem).getByRole('note')).toHaveTextContent(L.phoneWarning.landline);
    expect(within(landlineItem).queryByRole('link', { name: /واتساب/ })).toBeNull();

    const [todayItem] = within(todayList).getAllByRole('listitem');
    expect(todayItem).toHaveTextContent(L.noDoctor);
    expect(within(todayItem).getByRole('note')).toHaveTextContent(L.phoneWarning.missing);
  });
});

describe('LateCasesPage table (md and up)', () => {
  it('keeps one table per section, hidden below md, with one row per case', () => {
    renderPage();
    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(2);
    for (const table of tables) {
      expect(table.closest('.hidden.md\\:block')).not.toBeNull();
    }
    // header row + data rows
    expect(within(tables[0]).getAllByRole('row')).toHaveLength(3);
    expect(within(tables[1]).getAllByRole('row')).toHaveLength(2);
    expect(within(tables[0]).getAllByRole('link', { name: /واتساب/ })).toHaveLength(1);
  });

  it('never wraps the case number', () => {
    renderPage();
    const table = screen.getAllByRole('table')[0];
    const num = within(table).getByText('CASE-202610-00004');
    expect(num).toHaveClass('whitespace-nowrap');
  });
});

describe('CaseNumber', () => {
  it('is LTR, monospaced and never wraps, keeping extra classes', () => {
    render(<CaseNumber value="CASE-202610-00004" className="font-medium" />);
    const el = screen.getByText('CASE-202610-00004');
    expect(el).toHaveAttribute('dir', 'ltr');
    expect(el).toHaveClass('font-mono', 'whitespace-nowrap', 'font-medium');
  });
});
