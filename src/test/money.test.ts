/**
 * Money helpers (EGP): Western digits, 2 decimals, "ج.م"; input parsing without
 * floating-point arithmetic; this-month range in Cairo.
 */
import { describe, it, expect } from 'vitest';
import { formatMoney, formatAmount, parseMoneyInput, parsePercentInput, negateAmount, cairoMonthRange } from '@/lib/money';

const LRI = '⁦';
const PDI = '⁩';

describe('formatMoney', () => {
  it.each([
    [0, '0.00'],
    [5, '5.00'],
    [1234.5, '1,234.50'],
    ['1234.5', '1,234.50'],
    [-300, '-300.00'],
    [9999999999.99, '9,999,999,999.99'],
    [0.1 + 0.2, '0.30'],
  ])('%s -> %s ج.م (Western digits, 2 decimals)', (value, amount) => {
    expect(formatAmount(value)).toBe(amount);
    expect(formatMoney(value)).toBe(`${LRI}${amount}${PDI} ج.م`);
  });

  it('never uses Arabic-Indic digits', () => {
    expect(formatMoney(1234567.89)).not.toMatch(/[٠-٩]/);
  });

  it('shows a dash for missing values', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
    expect(formatAmount('')).toBe('—');
  });
});

describe('parseMoneyInput', () => {
  it.each([
    ['1500', '1500.00'],
    ['1,500.5', '1500.50'],
    [' 99.99 ', '99.99'],
    ['١٢٣٫٤', '123.40'],
    ['-250', '-250.00'],
    ['0', '0.00'],
    ['.5', '0.50'],
    ['-.5', '-0.50'],
    ['‏1,500‎', '1500.00'],
    ['⁦250⁩', '250.00'],
  ])('%s -> %s', (input, out) => {
    expect(parseMoneyInput(input)).toBe(out);
  });

  it.each([[''], ['abc'], ['1.234'], ['1e5'], ['12345678901'], ['--5'], ['5-']])('rejects %s', (input) => {
    expect(parseMoneyInput(input)).toBeNull();
  });

  it('can forbid negative amounts', () => {
    expect(parseMoneyInput('-5', { allowNegative: false })).toBeNull();
  });
});

describe('parsePercentInput', () => {
  it.each([['10', '10.00'], ['12.5', '12.50'], ['0', '0.00'], ['100', '100.00'], ['٢٥', '25.00']])('%s -> %s', (i, o) => {
    expect(parsePercentInput(i)).toBe(o);
  });
  it.each([['-1'], ['100.01'], ['101'], ['x']])('rejects %s', (i) => {
    expect(parsePercentInput(i)).toBeNull();
  });
});

describe('negateAmount', () => {
  it.each([[300, '-300.00'], ['300.5', '-300.50'], [-40, '40.00'], ['0.10', '-0.10']])('%s -> %s', (v, o) => {
    expect(negateAmount(v)).toBe(o);
  });
});

describe('cairoMonthRange', () => {
  it.each([
    ['2026-10-22', '2026-10-01', '2026-10-31'],
    ['2026-02-10', '2026-02-01', '2026-02-28'],
    ['2028-02-29', '2028-02-01', '2028-02-29'],
    ['2026-12-31', '2026-12-01', '2026-12-31'],
  ])('%s -> %s..%s', (today, from, to) => {
    expect(cairoMonthRange(today)).toEqual({ from, to });
  });
});
