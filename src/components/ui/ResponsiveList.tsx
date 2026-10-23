import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Phone layout for list pages: below `md` each row is a card in a labelled list;
 * from `md` up the page shows its table inside <DesktopTable>. Both are rendered from
 * the same rows (CSS picks one), so data fetching, filters and pagination are shared.
 */

/** A list must have an accessible name: the visible heading (preferred) or a label. */
type ListName =
  | { 'aria-labelledby': string; 'aria-label'?: never }
  | { 'aria-label': string; 'aria-labelledby'?: never };

/**
 * Explicit role="list": Safari / iOS VoiceOver drops list semantics from a <ul> whose
 * list-style is none (Tailwind's reset), so the number of items would not be announced.
 */
export function MobileList({ children, className, ...name }: ListName & { children: ReactNode; className?: string }) {
  return (
    <ul role="list" className={cn('divide-y divide-slate-100 md:hidden', className)} {...name}>
      {children}
    </ul>
  );
}

export function MobileListItem({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cn('space-y-3 p-4', className)}>{children}</li>;
}

/** Title line of a card (e.g. case number + status badge). Wraps instead of overlapping. */
export function MobileItemHeader({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-2">{children}</div>;
}

/** Label / value pairs of a card. Children are <MobileField>s. */
export function MobileFields({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 text-sm', className)}>
      {children}
    </dl>
  );
}

export function MobileField({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className={cn('min-w-0 break-words', className)}>{children}</dd>
    </>
  );
}

/**
 * Card buttons and links: every direct child is at least 44px high (tap target) and
 * they share the row, wrapping as needed. Callers do not add the height themselves.
 */
export function MobileActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-2 *:min-h-11 *:flex-1">{children}</div>;
}

/** md and up: the table (hidden on phones, where the <MobileList> is shown). */
export function DesktopTable({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('hidden overflow-x-auto md:block', className)}>{children}</div>;
}
