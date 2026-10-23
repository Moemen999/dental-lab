/**
 * KNOWN_ISSUES #16: useDashboardStats makes ONE call (RPC get_owner_dashboard_stats)
 * instead of 17 count queries, and maps the result to the numbers the dashboard shows.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc, from } }));

import { useDashboardStats } from '@/hooks/useSupabase';

describe('useDashboardStats', () => {
  it('calls get_owner_dashboard_stats once and maps every number', async () => {
    rpc.mockResolvedValue({
      data: {
        in_progress: 4, delivered: 7, awaiting_representative_pickup: 2, with_representative: 1,
        total: 30, overdue: 3, active_employees: 6, total_outstanding: 12345.5,
        unpriced_delivered_count: 2, delivered_without_dentist_count: 1,
      },
      error: null,
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useDashboardStats(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_owner_dashboard_stats');
    expect(from).not.toHaveBeenCalled();
    expect(result.current.data).toMatchObject({
      in_progress: 4, delivered: 7, registered: 0, cancelled: 0, total: 30, overdue: 3, activeEmployees: 6,
      totalOutstanding: 12345.5, unpricedDeliveredCount: 2, deliveredWithoutDentistCount: 1,
    });
  });

  it('surfaces a database error', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0001', hint: 'err.auth.owner_only', message: 'Owner only' } });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useDashboardStats(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
