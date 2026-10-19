import { describe, it, expect } from 'vitest';
import { formatDate, formatRelativeTime, truncate, getInitials, isOverdue } from '@/lib/utils';

describe('Utility Functions', () => {
  it('formats dates cleanly', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    const formatted = formatDate('2026-05-15T10:00:00Z');
    expect(formatted).toContain('مايو');
    expect(formatted).toContain('2026');
    // Western digits, never Arabic-Indic (٠-٩)
    expect(formatted).not.toMatch(/[٠-٩]/);
  });

  it('formats relative times in Arabic', () => {
    expect(formatRelativeTime(null)).toBe('—');
    const now = Date.now();
    expect(formatRelativeTime(new Date(now).toISOString())).toBe('الآن');
    expect(formatRelativeTime(new Date(now - 5 * 60_000).toISOString())).toBe('قبل 5 دقائق');
    expect(formatRelativeTime(new Date(now - 2 * 3_600_000).toISOString())).toBe('قبل ساعتين');
  });

  it('truncates text properly', () => {
    expect(truncate('Hello World', 5)).toBe('Hello…');
    expect(truncate('Hi', 5)).toBe('Hi');
  });

  it('extracts initials correctly', () => {
    expect(getInitials('John Doe')).toBe('JD');
    expect(getInitials('Alice')).toBe('A');
    expect(getInitials('Dr. Robert Smith')).toBe('DR');
  });

  it('computes case overdue status accurately', () => {
    // Past due date on active case
    expect(isOverdue('2020-01-01', 'in_progress')).toBe(true);

    // Future due date on active case
    expect(isOverdue('2099-01-01', 'in_progress')).toBe(false);

    // Delivered case is never overdue
    expect(isOverdue('2020-01-01', 'delivered')).toBe(false);

    // Cancelled case is never overdue
    expect(isOverdue('2020-01-01', 'cancelled')).toBe(false);

    // Null due date is never overdue
    expect(isOverdue(null, 'in_progress')).toBe(false);
  });
});
