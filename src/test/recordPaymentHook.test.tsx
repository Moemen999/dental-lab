/**
 * useRecordPayment: a duplicate payment id (an earlier attempt was stored) is not an
 * error and not a second payment; the stored amount is read back by id.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { insert, single, eq, select } = vi.hoisted(() => {
  const single = vi.fn();
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  return { insert: vi.fn(), single, eq, select };
});
vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ insert, select }) } }));

import { useRecordPayment } from '@/hooks/useSupabase';

const payment = { id: 'pay-1', dentist_id: 'd1', case_id: null, amount: '50.00', method: 'cash' as const, note: null };

function hook() {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(() => useRecordPayment(), { wrapper }).result;
}

beforeEach(() => [insert, single, eq, select].forEach((f) => f.mockClear()));

describe('useRecordPayment', () => {
  it('returns the sent amount when the insert succeeds', async () => {
    insert.mockResolvedValue({ error: null });
    await expect(hook().current.mutateAsync(payment)).resolves.toEqual({ amount: '50.00', duplicate: false });
    expect(select).not.toHaveBeenCalled();
  });

  it('on a duplicate id reads the stored payment back and reports its amount', async () => {
    insert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key value violates unique constraint "payments_pkey"' } });
    single.mockResolvedValue({ data: { amount: 75 }, error: null });
    await expect(hook().current.mutateAsync(payment)).resolves.toEqual({ amount: 75, duplicate: true });
    expect(eq).toHaveBeenCalledWith('id', 'pay-1');
  });

  it('other errors are thrown', async () => {
    insert.mockResolvedValue({ error: { code: '42501', message: 'permission denied' } });
    await expect(hook().current.mutateAsync(payment)).rejects.toMatchObject({ code: '42501' });
  });
});
