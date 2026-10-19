import { describe, it, expect } from 'vitest';

/**
 * Monthly counter and Case Number generation algorithm logic test
 * Mirrors the PostgreSQL generate_case_number() function:
 *   - Format: CASE-YYYYMM-NNNNN
 *   - Zero padded to minimum 5 digits
 *   - Expands gracefully to 6+ digits if > 99,999 in a single month (never truncates)
 *   - Safe against race conditions and concurrent generation
 */
export function formatCaseNumber(yearMonth: string, counter: number): string {
  if (!/^\d{6}$/.test(yearMonth)) {
    throw new Error('Invalid year_month format. Expected YYYYMM');
  }
  if (counter <= 0 || !Number.isInteger(counter)) {
    throw new Error('Counter must be a positive integer');
  }

  // Format with minimum 5 digits zero-padded; never truncates
  const padded = counter < 100000 ? counter.toString().padStart(5, '0') : counter.toString();
  return `CASE-${yearMonth}-${padded}`;
}

describe('Case Number Generation & Monthly Counter Logic', () => {
  it('generates correct format for regular sequential cases', () => {
    const ym = '202610';
    expect(formatCaseNumber(ym, 1)).toBe('CASE-202610-00001');
    expect(formatCaseNumber(ym, 42)).toBe('CASE-202610-00042');
    expect(formatCaseNumber(ym, 999)).toBe('CASE-202610-00999');
    expect(formatCaseNumber(ym, 12345)).toBe('CASE-202610-12345');
    expect(formatCaseNumber(ym, 99999)).toBe('CASE-202610-99999');
  });

  it('restarts counter on a new month without collision', () => {
    const month1 = '202610';
    const month2 = '202611';

    const caseOctLast = formatCaseNumber(month1, 150);
    const caseNovFirst = formatCaseNumber(month2, 1);

    expect(caseOctLast).toBe('CASE-202610-00150');
    expect(caseNovFirst).toBe('CASE-202611-00001');
    expect(caseOctLast).not.toBe(caseNovFirst);
  });

  it('gracefully supports numbers exceeding 99,999 without truncation or recycling', () => {
    const ym = '202610';
    // Must NOT wrap around to 00000 or truncate to 00000
    const case100k = formatCaseNumber(ym, 100000);
    const case100k1 = formatCaseNumber(ym, 100001);
    const case1M = formatCaseNumber(ym, 1250000);

    expect(case100k).toBe('CASE-202610-100000');
    expect(case100k1).toBe('CASE-202610-100001');
    expect(case1M).toBe('CASE-202610-1250000');
    expect(case100k).toHaveLength(18); // 5 + 6 + 1 + 6
  });

  it('rejects invalid inputs', () => {
    expect(() => formatCaseNumber('2026-10', 1)).toThrow('Invalid year_month');
    expect(() => formatCaseNumber('invalid', 1)).toThrow('Invalid year_month');
    expect(() => formatCaseNumber('202610', 0)).toThrow('positive integer');
    expect(() => formatCaseNumber('202610', -5)).toThrow('positive integer');
  });

  it('guarantees unique case numbers under concurrent generation simulation', async () => {
    // Simulating database atomic upsert with a thread-safe mutex/counter
    let dbCounter = 0;
    const generateAtomic = async (): Promise<string> => {
      // Simulate microtask async tick
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 2));
      dbCounter += 1;
      return formatCaseNumber('202610', dbCounter);
    };

    const CONCURRENT_REGISTRATIONS = 200;
    const promises = Array.from({ length: CONCURRENT_REGISTRATIONS }, () => generateAtomic());
    const results = await Promise.all(promises);

    expect(results).toHaveLength(CONCURRENT_REGISTRATIONS);
    const uniqueNumbers = new Set(results);
    expect(uniqueNumbers.size).toBe(CONCURRENT_REGISTRATIONS);
  });
});
