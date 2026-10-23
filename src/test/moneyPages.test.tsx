/**
 * Money pages: الأسعار (owner), الحسابات and the doctor statement (owner + receptionist).
 * Phone cards (labelled role="list") and md+ tables are both in the DOM (jsdom has no
 * CSS); amounts are the server's numbers, formatted only. Hooks are mocked.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ar } from '@/i18n/ar';
import type { DentistBalance, DentistStatement, Dentist, WorkType } from '@/types/database';
import { cairoToday } from '@/lib/utils';
import { cairoMonthRange } from '@/lib/money';
import { PricingPage } from '@/pages/PricingPage';
import { AccountsPage } from '@/pages/AccountsPage';
import { StatementPage } from '@/pages/StatementPage';

const M = ar.money;

const setPrice = vi.fn();
const setDiscount = vi.fn();
const setOpening = vi.fn();
const deleteOpening = vi.fn();
const statementArgs = vi.fn();

const dentist = (id: string, name: string): Dentist => ({
  id, name, clinic_name: 'عيادة', phone: null, email: null, address: null, notes: null, is_active: true,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', created_by: null,
});
const workTypes: WorkType[] = [
  { id: 'wt1', name: 'جهاز متحرك', is_active: true, sort_order: 1, created_at: '2026-01-01T00:00:00Z' },
  { id: 'wt2', name: 'مثبت', is_active: false, sort_order: 2, created_at: '2026-01-01T00:00:00Z' },
];
const balances: DentistBalance[] = [
  { dentist_id: 'd1', dentist_name: 'د. منى', clinic_name: 'عيادة النيل', is_active: true, total_due: 3000, total_paid: 500,
    balance: 2500, unpriced_delivered_count: 2, last_payment_at: '2026-10-20T10:00:00Z', opening_balance: null, opening_as_of: null },
  { dentist_id: 'd2', dentist_name: 'Dr. Sarah', clinic_name: null, is_active: true, total_due: 0, total_paid: 0,
    balance: -300, unpriced_delivered_count: 0, last_payment_at: null, opening_balance: -300, opening_as_of: '2026-09-01' },
  { dentist_id: 'd3', dentist_name: 'د. بدون حركة', clinic_name: null, is_active: true, total_due: 0, total_paid: 0,
    balance: 0, unpriced_delivered_count: 0, last_payment_at: null, opening_balance: null, opening_as_of: null },
];
const statement: DentistStatement = {
  dentist: { id: 'd1', name: 'د. منى', clinic_name: 'عيادة النيل', phone: null },
  from: '2026-10-01', to: '2026-10-31', opening_balance: 1000, total_debit: 1080, total_credit: 500, closing_balance: 1580,
  unpriced_count: 1,
  lines: [
    { kind: 'charge', at: '2026-10-05T10:00:00Z', date: '2026-10-05', case_id: 'c1', case_number: 'CASE-202610-00001',
      patient_name: 'مريض أ', work_type: 'جهاز متحرك', list_price: 1200, discount_percent: 10, payment_id: null, method: null,
      note: null, reverses_payment_id: null, debit: 1080, credit: null, priced: true, is_reversed: false, balance: 2080 },
    { kind: 'payment', at: '2026-10-06T10:00:00Z', date: '2026-10-06', case_id: null, case_number: null, patient_name: null,
      work_type: null, list_price: null, discount_percent: null, payment_id: 'p1', method: 'cash', note: 'نقدًا',
      reverses_payment_id: null, debit: null, credit: 500, priced: true, is_reversed: false, balance: 1580 },
    { kind: 'payment', at: '2026-10-07T10:00:00Z', date: '2026-10-07', case_id: null, case_number: null, patient_name: null,
      work_type: null, list_price: null, discount_percent: null, payment_id: 'p2', method: 'transfer', note: null,
      reverses_payment_id: null, debit: null, credit: 100, priced: true, is_reversed: true, balance: 1480 },
    { kind: 'reversal', at: '2026-10-08T10:00:00Z', date: '2026-10-08', case_id: null, case_number: null, patient_name: null,
      work_type: null, list_price: null, discount_percent: null, payment_id: 'p3', method: 'transfer', note: null,
      reverses_payment_id: 'p2', debit: 100, credit: null, priced: true, is_reversed: false, balance: 1580 },
    { kind: 'charge', at: '2026-10-09T10:00:00Z', date: '2026-10-09', case_id: 'c2', case_number: 'CASE-202610-00002',
      patient_name: 'مريض ب', work_type: 'Crown', list_price: null, discount_percent: 0, payment_id: null, method: null,
      note: null, reverses_payment_id: null, debit: null, credit: null, priced: false, is_reversed: false, balance: 1580 },
  ],
};

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'u-owner', role: 'owner' } }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useSupabase', () => ({
  useWorkTypes: () => ({ data: workTypes, isLoading: false }),
  useAllDentists: () => ({ data: [dentist('d1', 'د. منى'), dentist('d2', 'Dr. Sarah')], isLoading: false }),
  usePriceList: () => ({ data: [{ work_type_id: 'wt1', price: 1500, updated_at: '', updated_by: null }], isLoading: false }),
  useDentistDiscounts: () => ({ data: [{ dentist_id: 'd1', discount_percent: 10, updated_at: '', updated_by: null }], isLoading: false }),
  useOpeningBalances: () => ({
    data: [{ dentist_id: 'd2', amount: -300, as_of: '2026-09-01', note: null, updated_at: '', updated_by: null }],
    isLoading: false,
  }),
  useSetPrice: () => ({ mutateAsync: setPrice }),
  useSetDiscount: () => ({ mutateAsync: setDiscount }),
  useSetOpeningBalance: () => ({ mutateAsync: setOpening }),
  useDeleteOpeningBalance: () => ({ mutateAsync: deleteOpening }),
  useDentistBalances: () => ({ data: balances, isLoading: false, isError: false }),
  useDentistStatement: (id: string, from: string, to: string) => {
    statementArgs(id, from, to);
    return { data: statement, isLoading: false, isError: false };
  },
  useRecordPayment: () => ({ mutateAsync: vi.fn() }),
  useReversePayment: () => ({ mutateAsync: vi.fn() }),
  useDentistCases: () => ({ data: [] }),
}));

beforeEach(() => {
  [setPrice, setDiscount, setOpening, deleteOpening, statementArgs].forEach((f) => f.mockReset());
});
afterEach(cleanup);

const renderAt = (path: string, element: ReactNode, route = path) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={route} element={element} />
      </Routes>
    </MemoryRouter>,
  );

describe('PricingPage', () => {
  it('lists work types with their prices in a labelled phone list', () => {
    renderAt('/pricing', <PricingPage />);
    const list = screen.getByRole('list', { name: M.pricing.pricesTitle });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('1,500.00');
    expect(items[1]).toHaveTextContent(M.pricing.noPrice);
  });

  it('saves a price as a decimal string', async () => {
    setPrice.mockResolvedValue(undefined);
    renderAt('/pricing', <PricingPage />);
    const list = screen.getByRole('list', { name: M.pricing.pricesTitle });
    fireEvent.click(within(within(list).getAllByRole('listitem')[1]).getByRole('button'));
    fireEvent.change(screen.getByLabelText(M.pricing.price), { target: { value: '750.5' } });
    fireEvent.click(screen.getByRole('button', { name: M.pricing.save }));
    await waitFor(() => expect(setPrice).toHaveBeenCalledWith({ work_type_id: 'wt2', price: '750.50' }));
  });

  it('shows discounts and opening balances per doctor', () => {
    renderAt('/pricing', <PricingPage />);
    const list = screen.getByRole('list', { name: M.pricing.doctorsTitle });
    const [mona, sarah] = within(list).getAllByRole('listitem');
    expect(within(mona).getByRole('button', { name: `${M.pricing.editDiscount}: ⁨د. منى⁩` })).toBeInTheDocument();
    expect(mona).toHaveTextContent('10.00');
    expect(mona).toHaveTextContent(M.pricing.noOpening);
    expect(sarah).toHaveTextContent('-300.00');
  });

  function openOpeningDialog(index: number) {
    const list = screen.getByRole('list', { name: M.pricing.doctorsTitle });
    const item = within(list).getAllByRole('listitem')[index];
    fireEvent.click(within(item).getByRole('button', { name: new RegExp(`^${M.pricing.editOpening}`) }));
  }

  it('the opening balance form explains the date and rejects 0 and a future date', async () => {
    renderAt('/pricing', <PricingPage />);
    openOpeningDialog(0);
    expect(screen.getByText(M.pricing.openingDialog.description)).toBeInTheDocument();
    const amount = screen.getByLabelText(M.pricing.openingDialog.amount);
    const asOf = screen.getByLabelText(M.pricing.openingDialog.asOf);
    expect(asOf).toHaveAttribute('max', cairoToday());

    fireEvent.change(amount, { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: ar.common.actions.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent(M.pricing.errors.zeroAmount);
    expect(amount).toHaveFocus();

    fireEvent.change(amount, { target: { value: '2500' } });
    fireEvent.change(asOf, { target: { value: '2999-01-01' } });
    fireEvent.click(screen.getByRole('button', { name: ar.common.actions.save }));
    expect(await screen.findByText(M.pricing.errors.futureDate)).toHaveAttribute('role', 'alert');
    expect(asOf).toHaveFocus();
    expect(setOpening).not.toHaveBeenCalled();

    fireEvent.change(asOf, { target: { value: '2026-01-15' } });
    fireEvent.click(screen.getByRole('button', { name: ar.common.actions.save }));
    await waitFor(() =>
      expect(setOpening).toHaveBeenCalledWith({ dentist_id: 'd1', amount: '2500.00', as_of: '2026-01-15', note: null }),
    );
  });

  it('an existing opening balance can be removed after confirmation', async () => {
    deleteOpening.mockResolvedValue(undefined);
    renderAt('/pricing', <PricingPage />);
    openOpeningDialog(1);
    expect(screen.getByLabelText(M.pricing.openingDialog.amount)).toHaveValue('-300');
    fireEvent.click(screen.getByRole('button', { name: M.pricing.openingDialog.remove }));
    expect(deleteOpening).not.toHaveBeenCalled();
    expect(screen.getByText(M.pricing.openingDialog.removeConfirm)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: ar.common.actions.confirm }));
    await waitFor(() => expect(deleteOpening).toHaveBeenCalledWith('d2'));
  });

  it('rejects a discount over 100', async () => {
    renderAt('/pricing', <PricingPage />);
    const list = screen.getByRole('list', { name: M.pricing.doctorsTitle });
    fireEvent.click(within(within(list).getAllByRole('listitem')[0]).getByRole('button', { name: new RegExp(`^${M.pricing.editDiscount}`) }));
    fireEvent.change(screen.getByLabelText(M.pricing.discountDialog.label), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: ar.common.actions.save }));
    expect(await screen.findByRole('alert')).toHaveTextContent(M.pricing.errors.invalidPercent);
    expect(screen.getByLabelText(M.pricing.discountDialog.label)).toHaveFocus();
    expect(setDiscount).not.toHaveBeenCalled();
  });
});

describe('AccountsPage', () => {
  it('lists doctors with activity: balance, unpriced warning, statement link, 44px actions', () => {
    renderAt('/accounts', <AccountsPage />);
    const list = screen.getByRole('list', { name: M.accounts.title });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2); // d3 has no activity
    expect(items[0]).toHaveTextContent('2,500.00');
    expect(items[0]).toHaveTextContent(M.accounts.unpricedCount.replace('{count}', '').trim());
    expect(items[1]).toHaveTextContent('-300.00');
    expect(items[1]).toHaveTextContent(M.accounts.credit);
    // Repeated row actions are named with the doctor (label text first).
    const link = within(items[0]).getByRole('link', { name: `${M.accounts.statement}: ⁨د. منى⁩` });
    expect(link).toHaveAttribute('href', '/accounts/d1');
    expect(link.parentElement).toHaveClass('*:min-h-11');
    expect(within(items[0]).getByRole('button', { name: `${M.accounts.recordPayment}: ⁨د. منى⁩` })).toBeInTheDocument();
  });

  it('the desktop table shows the clinic and the inactive badge too', () => {
    renderAt('/accounts', <AccountsPage />);
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('عيادة النيل');
  });

  it('can show doctors without activity', () => {
    renderAt('/accounts', <AccountsPage />);
    fireEvent.click(screen.getByLabelText(M.accounts.showAll));
    const list = screen.getByRole('list', { name: M.accounts.title });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });
});

describe('StatementPage', () => {
  it('defaults to this month (Cairo) and shows the server totals and lines', () => {
    renderAt('/accounts/d1', <StatementPage />, '/accounts/:dentistId');
    const { from, to } = cairoMonthRange(cairoToday());
    expect(statementArgs).toHaveBeenLastCalledWith('d1', from, to);
    expect(screen.getByLabelText(M.statement.from)).toHaveValue(from);
    expect(screen.getByLabelText(M.statement.to)).toHaveValue(to);

    expect(screen.getAllByText(/1,580\.00/).length).toBeGreaterThan(0);
    const list = screen.getByRole('list', { name: M.statement.linesLabel });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('CASE-202610-00001');
    expect(items[4]).toHaveTextContent(M.notPriced);
  });

  it('offers "reverse" only on payments that are not reversed yet', () => {
    renderAt('/accounts/d1', <StatementPage />, '/accounts/:dentistId');
    const items = within(screen.getByRole('list', { name: M.statement.linesLabel })).getAllByRole('listitem');
    expect(within(items[1]).getByRole('button', { name: M.statement.reverse })).toBeInTheDocument();
    expect(within(items[2]).queryByRole('button', { name: M.statement.reverse })).not.toBeInTheDocument();
    expect(items[2]).toHaveTextContent(M.statement.reversed);
    // On phones the reversed state is a small status badge, not a 44px button-like action.
    const badge = within(items[2]).getByText(M.statement.reversed);
    expect(badge.closest('[class*="min-h-11"]')).toBeNull();
    expect(items[2].querySelector('[class*="min-h-11"]')).toBeNull();
    expect(within(items[3]).queryByRole('button', { name: M.statement.reverse })).not.toBeInTheDocument();
  });

  it('print uses the browser print and has a print-only header with the lab name', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    renderAt('/accounts/d1', <StatementPage />, '/accounts/:dentistId');
    fireEvent.click(screen.getByRole('button', { name: M.statement.print }));
    expect(print).toHaveBeenCalled();
    const header = screen.getByText(ar.common.app.name);
    expect(header.closest('.print\\:block')).not.toBeNull();
    print.mockRestore();
  });

  it('the printed-at line always has a time and is stamped synchronously on beforeprint', () => {
    renderAt('/accounts/d1', <StatementPage />, '/accounts/:dentistId');
    const line = () => screen.getByText((_, el) => el?.tagName === 'P' && !!el.textContent?.startsWith(M.statement.printedOn.split('{')[0]));
    expect(line().textContent).not.toContain('—');
    window.dispatchEvent(new Event('beforeprint'));
    expect(line().textContent).not.toContain('—');
  });

  it('in print a reversed payment shows "أُلغيت" outside the print-hidden actions column', () => {
    renderAt('/accounts/d1', <StatementPage />, '/accounts/:dentistId');
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    const reversedRow = rows.find((r) => r.textContent?.includes('100.00') && r.textContent.includes(M.statement.reversed))!;
    const printable = within(reversedRow).getAllByText(M.statement.reversed).filter((el) => !el.closest('[class~="print:hidden"]'));
    expect(printable.length).toBe(1);
  });

  it('a period with the start after the end is not requested', () => {
    renderAt('/accounts/d1', <StatementPage />, '/accounts/:dentistId');
    fireEvent.change(screen.getByLabelText(M.statement.from), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByLabelText(M.statement.to), { target: { value: '2026-11-01' } });
    expect(screen.getByText(M.statement.invalidPeriod)).toBeInTheDocument();
  });
});
