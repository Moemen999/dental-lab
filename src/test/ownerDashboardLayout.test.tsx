/**
 * Owner dashboard "recent cases" rows on phones: the case number never wraps, so the
 * row must wrap instead (badge + time drop below the case number) rather than overlap.
 * jsdom has no layout engine, so this checks the responsive classes that guarantee it.
 * Layout only: the data hooks are mocked here.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ar } from '@/i18n/ar';
import { OwnerDashboard } from '@/pages/OwnerDashboard';

const { stats, query } = vi.hoisted(() => ({
  stats: {} as Record<string, number | undefined>,
  query: { isError: false, error: null as unknown },
}));

vi.mock('@/hooks/useSupabase', () => ({
  useDashboardStats: () => (query.isError
    ? { data: undefined, isLoading: false, isError: true, error: query.error }
    : { data: stats, isLoading: false, isError: false, error: null }),
  useLateCaseCounts: () => ({ data: { late_count: 0, today_count: 0 }, isLoading: false, isError: false }),
  useCases: () => ({
    data: {
      data: [{
        id: 'c10', case_number: 'CASE-202610-00010', patient_name: 'مريض باسم طويل جدا للتجربة',
        case_type: 'جهاز متحرك', current_status: 'awaiting_representative_pickup',
        created_at: '2026-10-22T08:00:00Z',
      }],
      count: 1,
    },
    isLoading: false,
  }),
}));

afterEach(cleanup);

describe('OwnerDashboard recent case row', () => {
  it('wraps the row instead of letting the unbroken case number run under the badge', () => {
    render(
      <MemoryRouter>
        <OwnerDashboard />
      </MemoryRouter>,
    );

    const num = screen.getByText('CASE-202610-00010');
    expect(num).toHaveClass('whitespace-nowrap');

    const row = num.closest('a');
    expect(row).toHaveAttribute('href', '/cases/c10');
    expect(row).toHaveClass('flex', 'flex-wrap');

    // Text block: grows, may shrink for the truncated patient line, but its flex basis
    // (11rem) is wider than the case number, so the badge wraps before they collide.
    const textBlock = row!.firstElementChild!;
    expect(textBlock).toContainElement(num);
    expect(textBlock).toHaveClass('min-w-0', 'flex-1', 'basis-44');

    // Badge + time block: may wrap itself and is not forced to keep its width.
    const badgeBlock = row!.lastElementChild!;
    expect(badgeBlock).toHaveTextContent(ar.enums.caseStatus.awaiting_representative_pickup);
    expect(badgeBlock).toHaveClass('flex', 'flex-wrap');
    expect(badgeBlock).not.toHaveClass('shrink-0');
  });
});

describe('OwnerDashboard money cards (get_owner_dashboard_stats)', () => {
  it('shows the total outstanding from the server, linking to the accounts', () => {
    Object.assign(stats, { totalOutstanding: 12345.5, unpricedDeliveredCount: 0 });
    render(
      <MemoryRouter>
        <OwnerDashboard />
      </MemoryRouter>,
    );
    const card = screen.getByRole('link', { name: new RegExp(ar.money.dashboard.outstanding) });
    expect(card).toHaveAttribute('href', '/accounts');
    expect(card).toHaveTextContent('12,345.50');
    expect(screen.queryByText(ar.money.dashboard.unpricedTitle)).not.toBeInTheDocument();
  });

  it('warns about delivered cases without a price, linking to the price page', () => {
    Object.assign(stats, { totalOutstanding: 0, unpricedDeliveredCount: 3 });
    render(
      <MemoryRouter>
        <OwnerDashboard />
      </MemoryRouter>,
    );
    const warning = screen.getByRole('link', { name: new RegExp(ar.money.dashboard.unpricedTitle) });
    expect(warning).toHaveAttribute('href', '/pricing');
    expect(warning).toHaveTextContent('3');
  });
});

describe('OwnerDashboard money states', () => {
  const renderDash = () =>
    render(
      <MemoryRouter>
        <OwnerDashboard />
      </MemoryRouter>,
    );

  it('shows "—" (not 0) when the total is missing', () => {
    query.isError = false;
    Object.assign(stats, { totalOutstanding: undefined, unpricedDeliveredCount: 0, deliveredWithoutDentistCount: 0 });
    renderDash();
    const card = screen.getByRole('link', { name: new RegExp(ar.money.dashboard.outstanding) });
    expect(card).toHaveTextContent('—');
    expect(card).not.toHaveTextContent('0.00');
  });

  it('warns about delivered cases without a doctor', () => {
    query.isError = false;
    Object.assign(stats, { totalOutstanding: 10, unpricedDeliveredCount: 0, deliveredWithoutDentistCount: 2 });
    renderDash();
    const card = screen.getByRole('link', { name: new RegExp(ar.money.dashboard.noDentistTitle) });
    expect(card).toHaveAttribute('href', '/cases?status=delivered');
    expect(card).toHaveTextContent('2');
  });

  it('shows a visible error when the stats cannot be loaded', () => {
    query.isError = true;
    query.error = { code: 'P0001', hint: 'err.auth.owner_only' };
    renderDash();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(ar.money.dashboard.statsError);
    expect(alert).toHaveTextContent(ar.errors.db['err.auth.owner_only']);
    query.isError = false;
  });
});
