import { Button } from './Button';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { t } from '@/i18n';

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  totalItems?: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ currentPage, totalPages, totalItems, pageSize = 15, onPageChange }: PaginationProps) {
  const start = totalItems ? (currentPage - 1) * pageSize + 1 : undefined;
  const end = totalItems ? Math.min(currentPage * pageSize, totalItems) : undefined;

  return (
    <nav className="flex items-center justify-between px-2 py-3" aria-label={t('common.pagination.pageOf', { page: currentPage, total: totalPages })}>
      {totalItems !== undefined && start !== undefined && end !== undefined ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          {t('common.pagination.showing', { start, end, total: totalItems })}
        </p>
      ) : (
        <div />
      )}
      <div className="flex items-center gap-2">
        {/* Chevrons point toward the reading direction: "previous" points right in RTL. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          <ChevronLeft className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
          {t('common.pagination.previous')}
        </Button>
        <span className="text-sm text-[var(--muted-foreground)]">
          {t('common.pagination.pageOf', { page: currentPage, total: totalPages })}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          {t('common.pagination.next')}
          <ChevronRight className="h-4 w-4 rtl:-scale-x-100" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
