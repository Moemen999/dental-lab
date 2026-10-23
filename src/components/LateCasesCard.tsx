import { Link } from 'react-router-dom';
import { AlarmClock } from 'lucide-react';
import { useLateCaseCounts } from '@/hooks/useSupabase';
import { t } from '@/i18n';

/** Late + due-today counts (owner and receptionist dashboards), linking to /late-cases. */
export function LateCasesCard() {
  const { data, isLoading, isError } = useLateCaseCounts();
  if (isError) return null;

  const late = data?.late_count ?? 0;
  const today = data?.today_count ?? 0;
  const alert = late > 0;

  return (
    <Link
      to="/late-cases"
      aria-label={`${t('lateCases.card.open')}: ${t('lateCases.card.summary', { late, today })}`}
      className={`flex items-center justify-between gap-4 rounded-lg border p-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] ${
        alert
          ? 'border-[var(--destructive)] bg-red-50 hover:bg-red-100'
          : 'border-[var(--border)] bg-white hover:bg-brand-teal-50'
      }`}
    >
      <div className="flex items-center gap-3">
        <AlarmClock
          className={`h-6 w-6 shrink-0 ${alert ? 'text-[var(--destructive)]' : 'text-brand-teal'}`}
          aria-hidden="true"
        />
        <div>
          <p className="font-semibold text-[var(--foreground)]">{t('lateCases.card.title')}</p>
          <p className="text-sm text-[var(--muted-foreground)]">
            {isLoading ? '…' : t('lateCases.card.summary', { late, today })}
          </p>
        </div>
      </div>
      <span className="text-sm font-medium text-brand-teal">{t('lateCases.card.open')}</span>
    </Link>
  );
}
