import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useParams } from 'react-router-dom';
import { FileText, Printer, ArrowRight } from 'lucide-react';
import { useDentistStatement } from '@/hooks/useSupabase';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { AutoDir, CaseNumber } from '@/components/ui/Bidi';
import {
  MobileList,
  MobileListItem,
  MobileItemHeader,
  MobileFields,
  MobileField,
  MobileActions,
  DesktopTable,
} from '@/components/ui/ResponsiveList';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { RecordPaymentDialog } from '@/components/money/RecordPaymentDialog';
import { ReversePaymentDialog } from '@/components/money/ReversePaymentDialog';
import { cairoMonthRange, formatMoney } from '@/lib/money';
import { cairoToday } from '@/lib/utils';
import { caseTypeLabel, type Money, type StatementLine } from '@/types/database';
import { formatDate, formatDateTime } from '@/lib/utils';
import { ar } from '@/i18n/ar';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { usePageTitle } from '@/hooks/usePageTitle';

/** Doctor statement for a period (Cairo dates), with a print view (A4, no app chrome). */
export function StatementPage() {
  const { dentistId } = useParams<{ dentistId: string }>();
  const month = cairoMonthRange(cairoToday());
  const [from, setFrom] = useState(month.from);
  const [to, setTo] = useState(month.to);
  const periodValid = !!from && !!to && from <= to;
  const { data: st, isLoading, isError, error } = useDentistStatement(dentistId, from, to);
  const [paying, setPaying] = useState(false);
  const [reversing, setReversing] = useState<{ id: string; amount: Money } | null>(null);
  const [printedAt, setPrintedAt] = useState<Date | null>(null);
  const [openedAt] = useState(() => new Date());

  // The letterhead shows when the page was printed, not when it was opened.
  useEffect(() => {
    // flushSync: the letterhead must be updated before the browser takes the print snapshot.
    const stamp = () => flushSync(() => setPrintedAt(new Date()));
    window.addEventListener('beforeprint', stamp);
    return () => window.removeEventListener('beforeprint', stamp);
  }, []);

  usePageTitle(st ? t('money.statement.pageTitle', { name: st.dentist.name }) : t('money.statement.title'));

  const lines = st?.lines ?? [];

  const details = (l: StatementLine) => {
    if (l.kind === 'opening') return l.note ? <AutoDir>{l.note}</AutoDir> : null;
    return (
      <span className="space-y-0.5">
        {l.case_number && (
          <span className="block">
            <CaseNumber value={l.case_number} /> {l.patient_name && <AutoDir>{l.patient_name}</AutoDir>}
          </span>
        )}
        {l.kind === 'charge' && l.work_type && <span className="block text-xs">{caseTypeLabel(l.work_type)}</span>}
        {l.method && <span className="block text-xs">{ar.money.method[l.method]}</span>}
        {l.note && l.kind !== 'charge' && <AutoDir className="block text-xs">{l.note}</AutoDir>}
      </span>
    );
  };
  const debitText = (l: StatementLine) => (l.kind === 'charge' && !l.priced ? t('money.notPriced') : l.debit === null ? '' : formatMoney(l.debit));
  const creditText = (l: StatementLine) => (l.credit === null ? '' : formatMoney(l.credit));
  // is_reversed comes with the statement (migration 017): no second query, no stale state.
  const canReverse = (l: StatementLine) => l.kind === 'payment' && !!l.payment_id && !l.is_reversed;
  const reversedBadge = (l: StatementLine) =>
    l.kind === 'payment' && l.is_reversed ? <Badge variant="secondary">{t('money.statement.reversed')}</Badge> : null;
  const reverseButton = (l: StatementLine, mobile: boolean) =>
    canReverse(l) ? (
      <Button
        variant="outline"
        size={mobile ? 'default' : 'sm'}
        className="print:hidden"
        onClick={() => setReversing({ id: l.payment_id!, amount: l.credit! })}
      >
        {t('money.statement.reverse')}
      </Button>
    ) : null;

  const summary = st && (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4 print:grid-cols-4">
      {[
        [t('money.statement.openingBalance'), st.opening_balance],
        [t('money.statement.totalDebit'), st.total_debit],
        [t('money.statement.totalCredit'), st.total_credit],
        [t('money.statement.closingBalance'), st.closing_balance],
      ].map(([label, value]) => (
        <div key={label as string} className="rounded-md border border-[var(--border)] p-3">
          <dt className="text-xs text-[var(--muted-foreground)]">{label}</dt>
          <dd className="mt-1 font-semibold">{formatMoney(value as Money)}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    <div className="space-y-6">
      {/* Print-only letterhead (the app sidebar and header are hidden when printing). */}
      <div className="hidden print:block border-b border-slate-300 pb-3">
        <p className="text-lg font-bold">{t('common.app.name')}</p>
        <p className="text-base font-semibold">
          {t('money.statement.title')}: {st && <AutoDir>{st.dentist.name}</AutoDir>}
          {st?.dentist.clinic_name && <> — <AutoDir>{st.dentist.clinic_name}</AutoDir></>}
        </p>
        <p className="text-sm">{t('money.statement.periodLabel', { from: formatDate(from), to: formatDate(to) })}</p>
        <p className="text-xs text-slate-600">{t('money.statement.printedOn', { date: formatDateTime(printedAt ?? openedAt) })}</p>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="min-w-0">
          <Link to="/accounts" className="inline-flex min-h-11 items-center gap-1 text-sm text-brand-teal hover:underline">
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
            {t('money.statement.back')}
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileText className="h-6 w-6 text-brand-teal" aria-hidden="true" />
            {t('money.statement.title')}
            {st && <AutoDir className="break-words">{st.dentist.name}</AutoDir>}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2 *:min-h-11">
          <Button variant="outline" onClick={() => window.print()} disabled={!st}>
            <Printer className="h-4 w-4" aria-hidden="true" />
            {t('money.statement.print')}
          </Button>
          {st && <Button onClick={() => setPaying(true)}>{t('money.accounts.recordPayment')}</Button>}
        </div>
      </div>

      <Card className="print:hidden">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="w-44">
            <Input type="date" label={t('money.statement.from')} value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="w-44">
            <Input type="date" label={t('money.statement.to')} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button
            variant="ghost"
            className="min-h-11"
            onClick={() => {
              setFrom(month.from);
              setTo(month.to);
            }}
          >
            {t('money.statement.thisMonth')}
          </Button>
          {!periodValid && (
            <p className="w-full text-sm text-red-700" role="alert">{t('money.statement.invalidPeriod')}</p>
          )}
        </CardContent>
      </Card>

      {isLoading && periodValid ? (
        <div className="flex justify-center py-16"><Spinner size="lg" /></div>
      ) : isError ? (
        <p className="text-sm text-red-700" role="alert">{errorMessage(error)}</p>
      ) : st ? (
        <>
          {summary}
          {st.unpriced_count > 0 && (
            <p className="text-sm text-amber-800">{t('money.statement.unpricedNote', { count: st.unpriced_count })}</p>
          )}
          <h2 id="statement-lines" className="sr-only">{t('money.statement.linesLabel')}</h2>
          <Card className="print:border-0 print:shadow-none">
            <CardContent className="p-0">
              {lines.length === 0 ? (
                <p className="p-6 text-sm text-[var(--muted-foreground)]">{t('money.statement.noLines')}</p>
              ) : (
                <>
                  <MobileList aria-labelledby="statement-lines" className="print:hidden">
                    {lines.map((l, i) => (
                      <MobileListItem key={`${l.kind}-${l.payment_id ?? l.case_id ?? i}`}>
                        <MobileItemHeader>
                          <span className="font-medium">{ar.money.lineKind[l.kind]}</span>
                          <span className="flex items-center gap-2 text-sm text-[var(--muted-foreground)]">
                            {reversedBadge(l)}
                            {formatDate(l.date)}
                          </span>
                        </MobileItemHeader>
                        <MobileFields>
                          {details(l) && <MobileField label={t('money.statement.details')}>{details(l)}</MobileField>}
                          {debitText(l) && <MobileField label={t('money.statement.debit')}>{debitText(l)}</MobileField>}
                          {creditText(l) && <MobileField label={t('money.statement.credit')}>{creditText(l)}</MobileField>}
                          <MobileField label={t('money.statement.balance')}>{formatMoney(l.balance)}</MobileField>
                        </MobileFields>
                        {canReverse(l) && <MobileActions>{reverseButton(l, true)}</MobileActions>}
                      </MobileListItem>
                    ))}
                  </MobileList>
                  <DesktopTable className="print:block print:overflow-visible">
                    <Table>
                      <caption className="sr-only print:not-sr-only print:mb-2 print:text-start print:text-sm">
                        {t('money.statement.periodLabel', { from: formatDate(from), to: formatDate(to) })}
                      </caption>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('money.statement.date')}</TableHead>
                          <TableHead>{t('money.statement.kind')}</TableHead>
                          <TableHead>{t('money.statement.details')}</TableHead>
                          <TableHead>{t('money.statement.debit')}</TableHead>
                          <TableHead>{t('money.statement.credit')}</TableHead>
                          <TableHead>{t('money.statement.balance')}</TableHead>
                          <TableHead className="print:hidden"><span className="sr-only">{t('common.labels.actions')}</span></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.map((l, i) => (
                          <TableRow key={`${l.kind}-${l.payment_id ?? l.case_id ?? i}`} className="break-inside-avoid">
                            <TableCell className="whitespace-nowrap">{formatDate(l.date)}</TableCell>
                            <TableCell>{ar.money.lineKind[l.kind]}</TableCell>
                            <TableCell>
                              {details(l)}
                              {/* The actions column is not printed: show the reversed state on paper here. */}
                              {l.kind === 'payment' && l.is_reversed && (
                                <span className="hidden print:block text-xs font-medium">{t('money.statement.reversed')}</span>
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">{debitText(l)}</TableCell>
                            <TableCell className="whitespace-nowrap">{creditText(l)}</TableCell>
                            <TableCell className="whitespace-nowrap font-medium">{formatMoney(l.balance)}</TableCell>
                            <TableCell className="print:hidden">{reverseButton(l, false) ?? reversedBadge(l)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </DesktopTable>
                </>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {st && dentistId && (
        <RecordPaymentDialog open={paying} onOpenChange={setPaying} dentistId={dentistId} dentistName={st.dentist.name} />
      )}
      <ReversePaymentDialog payment={reversing} onOpenChange={(o) => !o && setReversing(null)} />
    </div>
  );
}
