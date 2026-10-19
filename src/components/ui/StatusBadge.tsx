import type { CaseStatus, CasePriority } from '@/types/database';
import { CASE_STATUS_LABELS, CASE_STATUS_COLORS, PRIORITY_LABELS, PRIORITY_COLORS } from '@/types/database';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: CaseStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold',
        CASE_STATUS_COLORS[status],
        className
      )}
    >
      {CASE_STATUS_LABELS[status]}
    </span>
  );
}

interface PriorityBadgeProps {
  priority: CasePriority;
  className?: string;
}

export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold',
        PRIORITY_COLORS[priority],
        className
      )}
    >
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
