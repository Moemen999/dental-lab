/**
 * dev:mock money (dev/mock/money.ts) follows the same role rules as the database:
 * owner + receptionist see money; technician / representative get nothing.
 */
import { describe, it, expect } from 'vitest';
import { canReadMoney, checkMoneyWrite, moneyRpc } from '../../dev/mock/money';

describe('mock money role rules', () => {
  it.each(['technician', 'representative'] as const)('%s cannot read money or call the RPCs', (role) => {
    expect(canReadMoney(role)).toBe(false);
    expect(moneyRpc('get_dentist_balances', {}, role)?.error?.hint).toBe('err.money.forbidden');
    expect(moneyRpc('get_owner_dashboard_stats', {}, role)?.error?.hint).toBe('err.auth.owner_only');
  });

  it('receptionist reads balances but cannot set prices; owner can', () => {
    const balances = moneyRpc('get_dentist_balances', {}, 'receptionist');
    expect(balances?.error).toBeNull();
    expect((balances!.data as unknown[]).length).toBeGreaterThan(0);
    expect(checkMoneyWrite('price_list', 'upsert', 'receptionist', { work_type_id: 'wt2', price: '1' }, 'u-recep')?.code).toBe('42501');
    expect(checkMoneyWrite('price_list', 'upsert', 'owner', { work_type_id: 'wt2', price: '1' }, 'u-owner')).toBeNull();
  });

  it('payments: duplicate id, append-only, opening balance rules', () => {
    expect(checkMoneyWrite('payments', 'insert', 'owner', { id: 'p1', dentist_id: 'd1', amount: '5' }, 'u-owner')?.code).toBe('23505');
    expect(checkMoneyWrite('payments', 'update', 'owner', { amount: '5' }, 'u-owner')?.hint).toBe('err.payment.append_only');
    expect(checkMoneyWrite('dentist_opening_balances', 'upsert', 'owner', { dentist_id: 'd1', amount: '0', as_of: '2026-01-01' }, 'u-owner')?.hint)
      .toBe('err.opening_balance.zero_amount');
  });

  it('statement and dashboard return data for the owner', () => {
    const st = moneyRpc('get_dentist_statement', { p_dentist_id: 'd2', p_from: '2000-01-01', p_to: '2100-12-31' }, 'owner');
    expect(st?.error).toBeNull();
    expect((st!.data as { lines: unknown[] }).lines.length).toBeGreaterThan(0);
    expect(moneyRpc('get_owner_dashboard_stats', {}, 'owner')?.error).toBeNull();
  });
});
