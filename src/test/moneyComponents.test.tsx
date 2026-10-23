/**
 * Money components: record-payment dialog (one id per opening, so a double submit or
 * a retry cannot create two payments), reversal confirmation, and the case "الحساب"
 * card (owner/receptionist only; owner edits the price). Hooks are mocked.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ar } from '@/i18n/ar';
import type { AppRole, CaseBalance } from '@/types/database';
import { RecordPaymentDialog } from '@/components/money/RecordPaymentDialog';
import { ReversePaymentDialog } from '@/components/money/ReversePaymentDialog';
import { CaseAccountCard } from '@/components/money/CaseAccountCard';
import { toast } from 'sonner';

const M = ar.money;

const recordPayment = vi.fn();
const reversePayment = vi.fn();
const updateCharge = vi.fn();
const auth = { role: 'owner' as AppRole };
let balance: CaseBalance | null = null;
const balanceQuery = { isError: false };
const caseBalanceArgs = vi.fn();

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ profile: { id: `u-${auth.role}`, role: auth.role } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useSupabase', () => ({
  useRecordPayment: () => ({ mutateAsync: recordPayment, isPending: false }),
  useReversePayment: () => ({ mutateAsync: reversePayment, isPending: false }),
  useUpdateCaseCharge: () => ({ mutateAsync: updateCharge, isPending: false }),
  useDentistCases: () => ({
    data: [{ id: 'c1', case_number: 'CASE-202610-00001', patient_name: 'مريض أ', current_status: 'delivered' }],
    isLoading: false,
  }),
  useCaseBalance: (id: string, enabled: boolean) => {
    caseBalanceArgs(id, enabled);
    return balanceQuery.isError
      ? { data: undefined, isLoading: false, isError: true, error: { code: '42501' } }
      : { data: balance, isLoading: false, isError: false, error: null };
  },
}));

beforeEach(() => {
  recordPayment.mockReset();
  reversePayment.mockReset();
  updateCharge.mockReset();
});
afterEach(cleanup);

function openPaymentDialog(props: Partial<Parameters<typeof RecordPaymentDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  const utils = render(
    <RecordPaymentDialog open dentistId="d1" dentistName="د. منى" onOpenChange={onOpenChange} {...props} />,
  );
  return { ...utils, onOpenChange };
}

describe('RecordPaymentDialog', () => {
  it('sends the same payment id when the save is retried (no second payment)', async () => {
    recordPayment.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(undefined);
    const { onOpenChange } = openPaymentDialog();
    fireEvent.change(screen.getByLabelText(M.payment.amount), { target: { value: '1,500.5' } });
    fireEvent.change(screen.getByLabelText(M.payment.method), { target: { value: 'transfer' } });
    fireEvent.change(screen.getByLabelText(M.payment.case), { target: { value: 'c1' } });

    fireEvent.click(screen.getByRole('button', { name: M.payment.submit }));
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: M.payment.submit }));
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(2));

    const [first, second] = recordPayment.mock.calls.map((c) => c[0]);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.id).toBe(first.id);
    expect(first).toMatchObject({ dentist_id: 'd1', case_id: 'c1', amount: '1500.50', method: 'transfer', note: null });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('a new opening of the dialog gets a new id', async () => {
    recordPayment.mockResolvedValue(undefined);
    const first = openPaymentDialog();
    fireEvent.change(screen.getByLabelText(M.payment.amount), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: M.payment.submit }));
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(1));
    first.unmount();

    openPaymentDialog();
    fireEvent.change(screen.getByLabelText(M.payment.amount), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: M.payment.submit }));
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(2));
    expect(recordPayment.mock.calls[1][0].id).not.toBe(recordPayment.mock.calls[0][0].id);
  });

  it.each([['0'], ['-5'], ['abc'], ['']])('rejects amount "%s" without calling the server', async (value) => {
    openPaymentDialog();
    fireEvent.change(screen.getByLabelText(M.payment.amount), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: M.payment.submit }));
    expect(await screen.findByText(M.payment.invalidAmount)).toBeInTheDocument();
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it('a fixed case (from the case page) is sent without a case picker', async () => {
    recordPayment.mockResolvedValue(undefined);
    openPaymentDialog({ caseId: 'c9' });
    expect(screen.queryByLabelText(M.payment.case)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(M.payment.amount), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: M.payment.submit }));
    await waitFor(() => expect(recordPayment).toHaveBeenCalledWith(expect.objectContaining({ case_id: 'c9', amount: '200.00' })));
  });
});

describe('RecordPaymentDialog hardening', () => {
  it('after the first attempt the amount, method and case are locked (same payment on retry)', async () => {
    recordPayment.mockRejectedValueOnce(new Error('network'));
    openPaymentDialog();
    fireEvent.change(screen.getByLabelText(M.payment.amount), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: M.payment.submit }));
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText(M.payment.amount)).toBeDisabled());
    expect(screen.getByLabelText(M.payment.method)).toBeDisabled();
    expect(screen.getByLabelText(M.payment.case)).toBeDisabled();
  });

  it('a definite database rejection unlocks the fields so they can be corrected', async () => {
    recordPayment.mockRejectedValueOnce({ code: 'P0001', hint: 'err.payment.case_not_billable', message: 'x' });
    openPaymentDialog();
    fireEvent.change(screen.getByLabelText(M.payment.amount), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: M.payment.submit }));
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByLabelText(M.payment.amount)).not.toBeDisabled());
    expect(screen.getByLabelText(M.payment.case)).not.toBeDisabled();
    expect(screen.queryByText(M.payment.lockedNote)).not.toBeInTheDocument();
  });

  it('a network/unknown error keeps the fields locked and says why', async () => {
    recordPayment.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    openPaymentDialog();
    fireEvent.change(screen.getByLabelText(M.payment.amount), { target: { value: '100' } });
    fireEvent.click(screen.getByRole('button', { name: M.payment.submit }));
    expect(await screen.findByText(M.payment.lockedNote)).toBeInTheDocument();
    expect(screen.getByLabelText(M.payment.amount)).toBeDisabled();
  });

  it('two quick clicks send one request', async () => {
    recordPayment.mockReturnValue(new Promise(() => {}));
    openPaymentDialog();
    fireEvent.change(screen.getByLabelText(M.payment.amount), { target: { value: '50' } });
    const submit = screen.getByRole('button', { name: M.payment.submit });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(1));
  });

  it('a duplicate-id answer shows the STORED amount', async () => {
    recordPayment.mockResolvedValue({ amount: 999, duplicate: true });
    openPaymentDialog();
    fireEvent.change(screen.getByLabelText(M.payment.amount), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: M.payment.submit }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('999.00')));
  });

  it('an invalid amount is announced and focused', async () => {
    openPaymentDialog();
    fireEvent.change(screen.getByLabelText(M.payment.amount), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: M.payment.submit }));
    expect(await screen.findByRole('alert')).toHaveTextContent(M.payment.invalidAmount);
    expect(screen.getByLabelText(M.payment.amount)).toHaveFocus();
  });

  it('no empty doctor name in the title', () => {
    openPaymentDialog({ dentistName: '' });
    expect(screen.getByRole('dialog', { name: M.payment.titleNoName })).toBeInTheDocument();
  });
});

describe('ReversePaymentDialog', () => {
  it('two quick clicks send one reversal', async () => {
    reversePayment.mockReturnValue(new Promise(() => {}));
    render(<ReversePaymentDialog payment={{ id: 'p1', amount: 10 }} onOpenChange={() => {}} />);
    const confirm = screen.getByRole('button', { name: M.reversal.confirm });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(reversePayment).toHaveBeenCalledTimes(1));
  });

  it('asks for confirmation and sends minus the original amount', async () => {
    reversePayment.mockResolvedValue(undefined);
    render(<ReversePaymentDialog payment={{ id: 'p1', amount: 300.5 }} onOpenChange={() => {}} />);
    expect(screen.getByText(/-300\.50/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: M.reversal.confirm }));
    await waitFor(() =>
      expect(reversePayment).toHaveBeenCalledWith({ reverses_payment_id: 'p1', amount: '-300.50', note: null }),
    );
  });
});

const caseData = { id: 'c1', dentist_id: 'd1', current_status: 'delivered', dentist: { name: 'د. منى' } } as never;

function renderCard(role: AppRole, b: CaseBalance | null, data = caseData) {
  auth.role = role;
  balance = b;
  return render(
    <MemoryRouter>
      <CaseAccountCard caseData={data} />
    </MemoryRouter>,
  );
}

const priced: CaseBalance = {
  case_id: 'c1', dentist_id: 'd1', list_price: 1200, discount_percent: 10, net_amount: 1080, price_source: 'list',
  is_priced: true, is_due: true, paid: 500, remaining: 580,
};

describe('CaseAccountCard', () => {
  it.each(['technician', 'representative'] as const)('renders nothing for a %s and never asks the server', (role) => {
    caseBalanceArgs.mockClear();
    const { container } = renderCard(role, priced);
    expect(container).toBeEmptyDOMElement();
    expect(caseBalanceArgs).toHaveBeenCalledWith('c1', false);
  });

  it('shows an error instead of hiding when the balance cannot be loaded', () => {
    balanceQuery.isError = true;
    renderCard('owner', priced);
    expect(screen.getByRole('alert')).toHaveTextContent(ar.errors.generic.permissionDenied);
    balanceQuery.isError = false;
  });

  it('no payment button for a case without a charge row (before the money module)', () => {
    renderCard('owner', { ...priced, list_price: null, net_amount: null, price_source: null, is_priced: false, is_due: false, remaining: null });
    expect(screen.queryByRole('button', { name: M.caseCard.recordPayment })).not.toBeInTheDocument();
  });

  it('shows price, discount, net, paid and remaining from the server', () => {
    renderCard('receptionist', priced);
    expect(screen.getByRole('heading', { name: M.caseCard.title })).toBeInTheDocument();
    expect(screen.getByText(/1,200\.00/)).toBeInTheDocument();
    expect(screen.getByText(/1,080\.00/)).toBeInTheDocument();
    expect(screen.getByText(/500\.00/)).toBeInTheDocument();
    expect(screen.getByText(/580\.00/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: M.caseCard.edit })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: M.caseCard.recordPayment })).toBeInTheDocument();
  });

  it('shows "غير مُسعّرة" for an unpriced case', () => {
    renderCard('owner', { ...priced, list_price: null, net_amount: null, is_priced: false, remaining: null });
    expect(screen.getAllByText(M.notPriced).length).toBeGreaterThan(0);
    expect(screen.queryByText(/1,080.00/)).not.toBeInTheDocument();
  });

  it('the owner edits the case price (sent as decimal strings)', async () => {
    updateCharge.mockResolvedValue(undefined);
    renderCard('owner', priced);
    fireEvent.click(screen.getByRole('button', { name: M.caseCard.edit }));
    fireEvent.change(screen.getByLabelText(M.caseCard.editDialog.listPrice), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText(M.caseCard.editDialog.discount), { target: { value: '5' } });
    // Enter in a field submits the form.
    fireEvent.submit(screen.getByLabelText(M.caseCard.editDialog.discount));
    await waitFor(() =>
      expect(updateCharge).toHaveBeenCalledWith({ case_id: 'c1', list_price: '1000.00', discount_percent: '5.00' }),
    );
  });

  it('no payment button for a cancelled case or a case without a doctor', () => {
    renderCard('owner', { ...priced, is_due: false, remaining: null }, { ...(caseData as object), current_status: 'cancelled' } as never);
    expect(screen.queryByRole('button', { name: M.caseCard.recordPayment })).not.toBeInTheDocument();
    cleanup();
    renderCard('owner', { ...priced, dentist_id: null, is_due: false, remaining: null }, { ...(caseData as object), dentist_id: null } as never);
    expect(screen.queryByRole('button', { name: M.caseCard.recordPayment })).not.toBeInTheDocument();
    expect(screen.getByText(M.caseCard.noDoctor)).toBeInTheDocument();
  });
});
