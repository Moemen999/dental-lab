import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Arabic (Egypt) with the Gregorian calendar and Western digits (0-9), so dates
 * use the same digits as case numbers, tooth numbers and counts.
 */
export const DATE_LOCALE = 'ar-EG-u-ca-gregory-nu-latn';

const dateFormatter = new Intl.DateTimeFormat(DATE_LOCALE, {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat(DATE_LOCALE, {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const relativeFormatter = new Intl.RelativeTimeFormat(DATE_LOCALE, { numeric: 'auto' });

/**
 * Format a date for display, e.g. "15 مايو 2026"
 */
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return dateFormatter.format(d);
}

/**
 * Format a date with time
 */
export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  return dateTimeFormatter.format(d);
}

/**
 * Format a relative time, e.g. "قبل 5 دقائق" (falls back to the date after a week)
 */
export function formatRelativeTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? new Date(date) : date;
  const diff = Date.now() - d.getTime();

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return relativeFormatter.format(0, 'second');
  if (minutes < 60) return relativeFormatter.format(-minutes, 'minute');

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return relativeFormatter.format(-hours, 'hour');

  const days = Math.floor(hours / 24);
  if (days < 7) return relativeFormatter.format(-days, 'day');

  return formatDate(d);
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, length) + '…';
}

/**
 * Generate initials from a name
 */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/**
 * Check if a case is overdue based on due date and status
 */
export function isOverdue(dueDate: string | null | undefined, status: string): boolean {
  if (!dueDate) return false;
  if (status === 'delivered' || status === 'cancelled') return false;
  const due = new Date(dueDate);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return due < now;
}

const cairoDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date in Africa/Cairo as 'YYYY-MM-DD'. */
export function cairoToday(now: Date = new Date()): string {
  return cairoDateFormatter.format(now);
}
