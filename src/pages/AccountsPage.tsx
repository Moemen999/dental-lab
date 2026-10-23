import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, AlertTriangle } from 'lucide-react';
import { useDentistBalances } from '@/hooks/useSupabase';
import { Card, CardContent } from '@/components/ui/Card';
import { Button, buttonVariants } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { AutoDir } from '@/components/ui/Bidi';
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
import { formatMoney } from '@/lib/money';
import { formatDate } from '@/lib/utils';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { usePageTitle } from '@/hooks/usePageTitle';
import type { DentistBalance } from '@/types/database';

const hasActivity = (b: DentistBalance) =>
  Number(b.balance) !== 0 || Number(b.total_due) !== 0 || Number(b.total_paid) !== 0 ||
  b.opening_balance !== null || b.unpriced_delivered_count > 0;

/** Owner + receptionist: balance per doctor (computed by get_dentist_balances). */
export function AccountsPage() {
  usePageTitle(t('money.accounts.title'));
  const { data, isLoading, isError, error } = useDentistBalances();
  const [showAll, setShowAll] = useState(false);
  const [paying, setPaying] = useState<DentistBalance | null>(null);

  const rows = (data ?? []).filter((b) => showAll || hasActivity(b));

  const balanceCell = (b: DentistBalance) => (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-semibold">{formatMoney(b.balance)}</span>
      {Number(b.balance) < 0 && <Badge variant="info">{t('money.accounts.credit')}</Badge>}
    </span>
  );
  const unpricedNote = (b: DentistBalance) =>
    b.unpriced_delivered_count > 0 ? (
      <span className="inline-flex items-center gap-1 text-amber-800">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t('money.accounts.unpricedCount', { count: b.unpriced_delivered_count })}
      </span>
    ) : null;
  const actions = (b: DentistBalance, mobile: boolean) => (
    <>
      <Link
        to={`/accounts/${b.dentist_id}`}
        aria-label={t('money.accounts.statementFor', { name: b.dentist_name })}
        className={buttonVariants({ variant: 'outline', size: mobile ? 'default' : 'sm' })}
      >
        {t('money.accounts.statement')}
      </Link>
      <Button
        size={mobile ? 'default' : 'sm'}
        onClick={() => setPaying(b)}
        aria-label={t('money.accounts.recordPaymentFor', { name: b.dentist_name })}
      >
        {t('money.accounts.recordPayment')}
      </Button>
    </>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 id="accounts-title" className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Wallet className="h-6 w-6 text-brand-teal" aria-hidden="true" />
          {t('money.accounts.title')}
        </h1>
        <p className="text-sm text-slate-500">{t('money.accounts.subtitle')}</p>
      </div>

      <label className="inline-flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        {t('money.accounts.showAll')}
      </label>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center py-16"><Spinner size="lg" /></div>
          ) : isError ? (
            <p className="p-6 text-sm text-red-700" role="alert">{errorMessage(error)}</p>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Wallet className="h-10 w-10" />}
              title={t('money.accounts.empty.title')}
              description={t('money.accounts.empty.description')}
            />
          ) : (
            <>
              <MobileList aria-labelledby="accounts-title">
                {rows.map((b) => (
                  <MobileListItem key={b.dentist_id}>
                    <MobileItemHeader>
                      <span className="min-w-0">
                        <AutoDir className="block break-words font-medium">{b.dentist_name}</AutoDir>
                        {b.clinic_name && (
                          <AutoDir className="block text-xs text-[var(--muted-foreground)]">{b.clinic_name}</AutoDir>
                        )}
                      </span>
                      {!b.is_active && <Badge variant="secondary">{t('money.accounts.inactiveDoctor')}</Badge>}
                    </MobileItemHeader>
                    <MobileFields>
                      <MobileField label={t('money.accounts.balance')}>{balanceCell(b)}</MobileField>
                      <MobileField label={t('money.accounts.due')}>{formatMoney(b.total_due)}</MobileField>
                      <MobileField label={t('money.accounts.paid')}>{formatMoney(b.total_paid)}</MobileField>
                      {b.opening_balance !== null && (
                        <MobileField label={t('money.accounts.opening')}>{formatMoney(b.opening_balance)}</MobileField>
                      )}
                      <MobileField label={t('money.accounts.lastPayment')}>{formatDate(b.last_payment_at)}</MobileField>
                    </MobileFields>
                    {unpricedNote(b) && <p className="text-sm">{unpricedNote(b)}</p>}
                    <MobileActions>{actions(b, true)}</MobileActions>
                  </MobileListItem>
                ))}
              </MobileList>
              <DesktopTable>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('money.accounts.doctor')}</TableHead>
                      <TableHead>{t('money.accounts.balance')}</TableHead>
                      <TableHead>{t('money.accounts.due')}</TableHead>
                      <TableHead>{t('money.accounts.paid')}</TableHead>
                      <TableHead>{t('money.accounts.opening')}</TableHead>
                      <TableHead>{t('money.accounts.lastPayment')}</TableHead>
                      <TableHead className="text-end">{t('common.labels.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((b) => (
                      <TableRow key={b.dentist_id}>
                        <TableCell>
                          <span className="flex flex-wrap items-center gap-2">
                            <AutoDir className="font-medium">{b.dentist_name}</AutoDir>
                            {!b.is_active && <Badge variant="secondary">{t('money.accounts.inactiveDoctor')}</Badge>}
                          </span>
                          {b.clinic_name && (
                            <AutoDir className="block text-xs text-[var(--muted-foreground)]">{b.clinic_name}</AutoDir>
                          )}
                          {unpricedNote(b) && <span className="block text-xs">{unpricedNote(b)}</span>}
                        </TableCell>
                        <TableCell>{balanceCell(b)}</TableCell>
                        <TableCell>{formatMoney(b.total_due)}</TableCell>
                        <TableCell>{formatMoney(b.total_paid)}</TableCell>
                        <TableCell>{b.opening_balance === null ? '—' : formatMoney(b.opening_balance)}</TableCell>
                        <TableCell>{formatDate(b.last_payment_at)}</TableCell>
                        <TableCell className="text-end">
                          <div className="flex justify-end gap-1">{actions(b, false)}</div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DesktopTable>
            </>
          )}
        </CardContent>
      </Card>

      {paying && (
        <RecordPaymentDialog
          open
          onOpenChange={(o) => !o && setPaying(null)}
          dentistId={paying.dentist_id}
          dentistName={paying.dentist_name}
        />
      )}
    </div>
  );
}
