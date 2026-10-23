import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Left-to-right island inside Arabic text: case numbers, tooth numbers, emails,
 * phone numbers, references. Keeps "CASE-202610-00001" and "+20 100..." intact.
 */
export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}

/** A case number, always LTR, monospaced and on one line (never split at the hyphen). */
export function CaseNumber({ value, className }: { value: string | null | undefined; className?: string }) {
  return (
    <bdi dir="ltr" className={cn('font-mono whitespace-nowrap', className)}>
      {value ?? '—'}
    </bdi>
  );
}

/**
 * Free text that may be Arabic or English (patient, dentist, clinic and staff names,
 * notes). The browser picks the direction from the first strong character.
 */
export function AutoDir({ children, className }: { children: ReactNode; className?: string }) {
  return <bdi className={className}>{children}</bdi>;
}
