import { useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Wallet, Edit2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useCaseBalance, useUpdateCaseCharge } from '@/hooks/useSupabase';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/Dialog';
import { RecordPaymentDialog } from '@/components/money/RecordPaymentDialog';
import { formatAmount, formatMoney, parseMoneyInput, parsePercentInput } from '@/lib/money';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import type { Case, CaseBalance } from '@/types/database';

/**
 * "الحساب" card on the case page: owner and receptionist only (the database also
 * refuses everyone else). Shows the server's price, discount, net, paid, remaining;
 * the owner can set this case's own price.
 */
export function CaseAccountCard({ caseData }: { caseData: Pick<Case, 'id' | 'dentist_id' | 'current_status' | 'dentist'> }) {
  const { profile } = useAuth();
  const allowed = profile?.role === 'owner' || profile?.role === 'receptionist';
  const { data: balance, isLoading, isError, error } = useCaseBalance(caseData.id, allowed);
  const [editing, setEditing] = useState(false);
  const [paying, setPaying] = useState(false);

  if (!allowed) return null;

  const isOwner = profile?.role === 'owner';
  const cancelled = caseData.current_status === 'cancelled';
  // Billable: has a doctor, is not cancelled, and has a charge row (cases delivered
  // before the money module have none; the database refuses payments on them).
  const canPay = !!caseData.dentist_id && !cancelled && !!balance && balance.price_source !== null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Wallet className="h-4 w-4" aria-hidden="true" />
          {t('money.caseCard.title')}
        </CardTitle>
        {isOwner && balance && (
          <Button variant="outline" size="sm" className="min-h-11 sm:min-h-8" onClick={() => setEditing(true)}>
            <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
            {t('money.caseCard.edit')}
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {isError ? (
          <p role="alert" className="text-sm text-red-700">{errorMessage(error)}</p>
        ) : isLoading ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : balance ? (
          <>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
              <dt className="text-[var(--muted-foreground)]">{t('money.caseCard.listPrice')}</dt>
              <dd>{balance.is_priced ? formatMoney(balance.list_price) : <Badge variant="warning">{t('money.notPriced')}</Badge>}</dd>
              {balance.is_priced && (
                <>
                  <dt className="text-[var(--muted-foreground)]">{t('money.caseCard.discount')}</dt>
                  <dd>{t('money.pricing.discountValue', { value: formatAmount(balance.discount_percent) })}</dd>
                  <dt className="text-[var(--muted-foreground)]">{t('money.caseCard.net')}</dt>
                  <dd className="font-semibold">{formatMoney(balance.net_amount)}</dd>
                </>
              )}
              <dt className="text-[var(--muted-foreground)]">{t('money.caseCard.paid')}</dt>
              <dd>{formatMoney(balance.paid)}</dd>
              <dt className="text-[var(--muted-foreground)]">{t('money.caseCard.remaining')}</dt>
              <dd className="font-semibold">{remainingText(balance, cancelled)}</dd>
            </dl>
            {balance.price_source === 'manual' && (
              <p className="text-xs text-[var(--muted-foreground)]">{t('money.caseCard.manual')}</p>
            )}
          </>
        ) : null}
        {!caseData.dentist_id && <p className="text-xs text-[var(--muted-foreground)]">{t('money.caseCard.noDoctor')}</p>}
        {canPay && (
          <Button variant="outline" className="w-full min-h-11" onClick={() => setPaying(true)}>
            {t('money.caseCard.recordPayment')}
          </Button>
        )}
      </CardContent>

      {isOwner && balance && (
        <EditCasePriceDialog open={editing} onOpenChange={setEditing} balance={balance} />
      )}
      {canPay && (
        <RecordPaymentDialog
          open={paying}
          onOpenChange={setPaying}
          dentistId={caseData.dentist_id!}
          dentistName={caseData.dentist?.name ?? ''}
          caseId={caseData.id}
        />
      )}
    </Card>
  );
}

function remainingText(b: CaseBalance, cancelled: boolean): string {
  if (cancelled) return t('money.caseCard.cancelled');
  if (!b.is_priced) return t('money.notPriced');
  if (!b.is_due) return t('money.caseCard.notDue');
  return formatMoney(b.remaining);
}

function EditCasePriceDialog({ open, onOpenChange, balance }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balance: CaseBalance;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <EditCasePriceForm balance={balance} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function EditCasePriceForm({ balance, onDone }: { balance: CaseBalance; onDone: () => void }) {
  const update = useUpdateCaseCharge();
  const [price, setPrice] = useState(balance.list_price === null ? '' : String(balance.list_price));
  const [discount, setDiscount] = useState(String(balance.discount_percent ?? 0));
  const [errors, setErrors] = useState<{ price?: string; discount?: string }>({});
  const [saving, setSaving] = useState(false);
  const priceRef = useRef<HTMLInputElement>(null);
  const discountRef = useRef<HTMLInputElement>(null);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const p = parseMoneyInput(price, { allowNegative: false });
    const d = parsePercentInput(discount);
    const next = {
      price: p === null ? t('money.pricing.errors.invalidPrice') : undefined,
      discount: d === null ? t('money.pricing.errors.invalidPercent') : undefined,
    };
    setErrors(next);
    if (p === null) priceRef.current?.focus();
    else if (d === null) discountRef.current?.focus();
    if (p === null || d === null) return;
    try {
      setSaving(true);
      await update.mutateAsync({ case_id: balance.case_id, list_price: p, discount_percent: d });
      toast.success(t('money.caseCard.saved'));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form noValidate onSubmit={handleSave}>
      <DialogHeader>
        <DialogTitle>{t('money.caseCard.editDialog.title')}</DialogTitle>
        <DialogDescription>{t('money.caseCard.editDialog.description')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <Input
          ref={priceRef}
          label={t('money.caseCard.editDialog.listPrice')}
          inputMode="decimal"
          dir="ltr"
          value={price}
          error={errors.price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <Input
          ref={discountRef}
          label={t('money.caseCard.editDialog.discount')}
          inputMode="decimal"
          dir="ltr"
          value={discount}
          error={errors.discount}
          onChange={(e) => setDiscount(e.target.value)}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('common.actions.cancel')}
        </Button>
        <Button type="submit" loading={saving}>
          {t('common.actions.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
