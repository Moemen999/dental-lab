import { Fragment, useId, type ReactNode } from 'react';
import { History } from 'lucide-react';
import { Ltr } from '@/components/ui/Bidi';
import { hasLegacySpecs, jawLabel, shadeLabel, type Case } from '@/types/database';
import { t } from '@/i18n';
import { tx } from '@/i18n/rich';
import { cn } from '@/lib/utils';

type JawFields = Pick<Case, 'upper_jaw' | 'lower_jaw'>;
type LegacyFields = Pick<Case, 'shade' | 'tooth_number'>;

/** Jaw of a case for list rows ('فك علوي' / 'فك سفلي' / 'الفك العلوي والسفلي'). Nothing for old cases. */
export function JawText({ value, className }: { value: JawFields; className?: string }) {
  const label = jawLabel(value.upper_jaw, value.lower_jaw);
  return label ? <span className={className}>{label}</span> : null;
}

/**
 * One line for list rows: "بيانات قديمة (قبل التحديث): اللون A2 · رقم السن 14".
 * Read-only shade / tooth number of a case registered before migration 014; nothing for new cases.
 */
export function LegacySpecsLine({ value, className }: { value: LegacyFields; className?: string }) {
  if (!hasLegacySpecs(value)) return null;
  const parts: ReactNode[] = [];
  if (value.shade?.trim()) {
    parts.push(tx('cases.legacySpecs.shadeValue', { value: <Ltr>{shadeLabel(value.shade)}</Ltr> }));
  }
  if (value.tooth_number?.trim()) {
    parts.push(tx('cases.legacySpecs.toothNumberValue', { value: <Ltr>{value.tooth_number}</Ltr> }));
  }
  return (
    <span className={cn('text-slate-500', className)}>
      {t('cases.legacySpecs.label')}{' '}
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

/** Case detail page: read-only box with the old shade / tooth number. Nothing for new cases. */
export function LegacySpecsSection({ value }: { value: LegacyFields }) {
  const titleId = useId();
  if (!hasLegacySpecs(value)) return null;
  return (
    <section
      aria-labelledby={titleId}
      className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3"
    >
      <p id={titleId} className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
        <History className="h-3.5 w-3.5" aria-hidden="true" />
        {t('cases.legacySpecs.title')}
      </p>
      <p className="mt-1 text-xs text-slate-600">{t('cases.legacySpecs.note')}</p>
      <dl className="mt-2 grid grid-cols-2 gap-3">
        {value.shade?.trim() && (
          <div>
            <dt className="text-xs text-slate-600">{t('cases.legacySpecs.shade')}</dt>
            <dd className="font-semibold text-slate-800"><Ltr>{shadeLabel(value.shade)}</Ltr></dd>
          </div>
        )}
        {value.tooth_number?.trim() && (
          <div>
            <dt className="text-xs text-slate-600">{t('cases.legacySpecs.toothNumber')}</dt>
            <dd className="font-semibold text-slate-800"><Ltr>{value.tooth_number}</Ltr></dd>
          </div>
        )}
      </dl>
    </section>
  );
}
