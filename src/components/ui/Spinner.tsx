import { cn } from '@/lib/utils';
import { t } from '@/i18n';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'default' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-6 w-6',
  default: 'h-8 w-8',
  lg: 'h-12 w-12',
};

export function Spinner({ size = 'default', className }: SpinnerProps) {
  return (
    <svg
      className={cn('animate-spin text-[var(--primary)]', sizeClasses[size], className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      role="status"
      aria-label={t('common.a11y.loading')}
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}
