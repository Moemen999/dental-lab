import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Tags, Edit2, Percent, Scale } from 'lucide-react';
import {
  useAllDentists,
  useDeleteOpeningBalance,
  useDentistDiscounts,
  useOpeningBalances,
  usePriceList,
  useSetDiscount,
  useSetOpeningBalance,
  useSetPrice,
  useWorkTypes,
} from '@/hooks/useSupabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { AutoDir } from '@/components/ui/Bidi';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/Dialog';
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
import { formatAmount, formatMoney, parseMoneyInput, parsePercentInput } from '@/lib/money';
import { cairoToday } from '@/lib/utils';
import { formatDate } from '@/lib/utils';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import { usePageTitle } from '@/hooks/usePageTitle';
import type { Dentist, DentistOpeningBalance, WorkType } from '@/types/database';

/** Owner: price per work type, discount and optional opening balance per doctor. */
export function PricingPage() {
  usePageTitle(t('money.pricing.title'));
  const { data: workTypes, isLoading: typesLoading } = useWorkTypes({ includeInactive: true });
  const { data: prices } = usePriceList();
  const { data: dentists, isLoading: dentistsLoading } = useAllDentists();
  const { data: discounts } = useDentistDiscounts();
  const { data: openings } = useOpeningBalances();

  const [pricing, setPricing] = useState<WorkType | null>(null);
  const [discounting, setDiscounting] = useState<Dentist | null>(null);
  const [opening, setOpening] = useState<Dentist | null>(null);

  const priceOf = (id: string) => prices?.find((p) => p.work_type_id === id)?.price ?? null;
  const discountOf = (id: string) => discounts?.find((d) => d.dentist_id === id)?.discount_percent ?? null;
  const openingOf = (id: string) => openings?.find((o) => o.dentist_id === id) ?? null;

  const priceText = (w: WorkType) => {
    const p = priceOf(w.id);
    return p === null ? t('money.pricing.noPrice') : formatMoney(p);
  };
  const discountText = (d: Dentist) => {
    const v = discountOf(d.id);
    return v === null || Number(v) === 0 ? t('money.pricing.noDiscount') : t('money.pricing.discountValue', { value: formatAmount(v) });
  };
  const openingText = (d: Dentist) => {
    const o = openingOf(d.id);
    return o ? `${formatMoney(o.amount)} — ${t('money.pricing.openingAsOf', { date: formatDate(o.as_of) })}` : t('money.pricing.noOpening');
  };

  const types = workTypes ?? [];
  const doctors = dentists ?? [];

  const priceButton = (w: WorkType, mobile: boolean) => (
    <Button
      variant="outline"
      size={mobile ? 'default' : 'sm'}
      onClick={() => setPricing(w)}
      aria-label={t('money.pricing.editPriceFor', { name: w.name })}
    >
      <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
      {t('common.actions.edit')}
    </Button>
  );
  const doctorButtons = (d: Dentist, mobile: boolean) => (
    <>
      <Button variant="outline" size={mobile ? 'default' : 'sm'} onClick={() => setDiscounting(d)}
        aria-label={t('money.pricing.editDiscountFor', { name: d.name })}
      >
        <Percent className="h-3.5 w-3.5" aria-hidden="true" />
        {t('money.pricing.editDiscount')}
      </Button>
      <Button variant="outline" size={mobile ? 'default' : 'sm'} onClick={() => setOpening(d)}
        aria-label={t('money.pricing.editOpeningFor', { name: d.name })}
      >
        <Scale className="h-3.5 w-3.5" aria-hidden="true" />
        {t('money.pricing.editOpening')}
      </Button>
    </>
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Tags className="h-6 w-6 text-brand-teal" aria-hidden="true" />
          {t('money.pricing.title')}
        </h1>
        <p className="text-sm text-slate-500">{t('money.pricing.subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle id="prices-title" className="text-base">{t('money.pricing.pricesTitle')}</CardTitle>
          <p className="text-sm text-[var(--muted-foreground)]">{t('money.pricing.pricesHint')}</p>
        </CardHeader>
        <CardContent className="p-0">
          {typesLoading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : types.length === 0 ? (
            <p className="p-6 text-sm text-[var(--muted-foreground)]">{t('money.pricing.noWorkTypes')}</p>
          ) : (
            <>
              <MobileList aria-labelledby="prices-title">
                {types.map((w) => (
                  <MobileListItem key={w.id}>
                    <MobileItemHeader>
                      <AutoDir className="min-w-0 break-words font-medium">{w.name}</AutoDir>
                      {!w.is_active && <Badge variant="secondary">{t('money.pricing.inactive')}</Badge>}
                    </MobileItemHeader>
                    <MobileFields>
                      <MobileField label={t('money.pricing.price')}>{priceText(w)}</MobileField>
                    </MobileFields>
                    <MobileActions>{priceButton(w, true)}</MobileActions>
                  </MobileListItem>
                ))}
              </MobileList>
              <DesktopTable>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('money.pricing.workType')}</TableHead>
                      <TableHead>{t('money.pricing.price')}</TableHead>
                      <TableHead className="text-end">{t('common.labels.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {types.map((w) => (
                      <TableRow key={w.id} className={w.is_active ? '' : 'text-slate-500'}>
                        <TableCell className="font-medium">
                          <AutoDir>{w.name}</AutoDir>
                          {!w.is_active && <Badge variant="secondary" className="ms-2">{t('money.pricing.inactive')}</Badge>}
                        </TableCell>
                        <TableCell>{priceText(w)}</TableCell>
                        <TableCell className="text-end">{priceButton(w, false)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </DesktopTable>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle id="doctors-title" className="text-base">{t('money.pricing.doctorsTitle')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {dentistsLoading ? (
            <div className="flex justify-center py-10"><Spinner /></div>
          ) : doctors.length === 0 ? (
            <p className="p-6 text-sm text-[var(--muted-foreground)]">{t('money.pricing.noDoctors')}</p>
          ) : (
            <>
              <MobileList aria-labelledby="doctors-title">
                {doctors.map((d) => (
                  <MobileListItem key={d.id}>
                    <MobileItemHeader>
                      <AutoDir className="min-w-0 break-words font-medium">{d.name}</AutoDir>
                    </MobileItemHeader>
                    <MobileFields>
                      <MobileField label={t('money.pricing.discount')}>{discountText(d)}</MobileField>
                      <MobileField label={t('money.pricing.openingBalance')}>{openingText(d)}</MobileField>
                    </MobileFields>
                    <MobileActions>{doctorButtons(d, true)}</MobileActions>
                  </MobileListItem>
                ))}
              </MobileList>
              <DesktopTable>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('money.pricing.doctor')}</TableHead>
                      <TableHead>{t('money.pricing.discount')}</TableHead>
                      <TableHead>{t('money.pricing.openingBalance')}</TableHead>
                      <TableHead className="text-end">{t('common.labels.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {doctors.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium"><AutoDir>{d.name}</AutoDir></TableCell>
                        <TableCell>{discountText(d)}</TableCell>
                        <TableCell>{openingText(d)}</TableCell>
                        <TableCell className="text-end">
                          <div className="flex justify-end gap-1">{doctorButtons(d, false)}</div>
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

      <Dialog open={!!pricing} onOpenChange={(o) => !o && setPricing(null)}>
        <DialogContent>
          {pricing && <PriceForm workType={pricing} current={priceOf(pricing.id)} onDone={() => setPricing(null)} />}
        </DialogContent>
      </Dialog>
      <Dialog open={!!discounting} onOpenChange={(o) => !o && setDiscounting(null)}>
        <DialogContent>
          {discounting && (
            <DiscountForm dentist={discounting} current={discountOf(discounting.id)} onDone={() => setDiscounting(null)} />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={!!opening} onOpenChange={(o) => !o && setOpening(null)}>
        <DialogContent>
          {opening && <OpeningForm dentist={opening} current={openingOf(opening.id)} onDone={() => setOpening(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FormFooter({ onCancel, saving, saveLabel }: { onCancel: () => void; saving: boolean; saveLabel: string }) {
  return (
    <DialogFooter>
      <Button type="button" variant="ghost" onClick={onCancel}>
        {t('common.actions.cancel')}
      </Button>
      <Button type="submit" loading={saving}>
        {saveLabel}
      </Button>
    </DialogFooter>
  );
}

function PriceForm({ workType, current, onDone }: { workType: WorkType; current: number | null; onDone: () => void }) {
  const setPrice = useSetPrice();
  const [value, setValue] = useState(current === null ? '' : String(current));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const price = parseMoneyInput(value, { allowNegative: false });
        if (price === null) {
          setError(t('money.pricing.errors.invalidPrice'));
          inputRef.current?.focus();
          return;
        }
        setError(undefined);
        try {
          setSaving(true);
          await setPrice.mutateAsync({ work_type_id: workType.id, price });
          toast.success(t('money.pricing.toasts.priceSaved', { name: workType.name }));
          onDone();
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setSaving(false);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('money.pricing.priceLabel', { name: workType.name })}</DialogTitle>
        <DialogDescription>{t('money.pricing.pricesHint')}</DialogDescription>
      </DialogHeader>
      <Input
        ref={inputRef}
        label={t('money.pricing.price')}
        inputMode="decimal"
        dir="ltr"
        autoComplete="off"
        value={value}
        error={error}
        onChange={(e) => setValue(e.target.value)}
      />
      <FormFooter onCancel={onDone} saving={saving} saveLabel={t('money.pricing.save')} />
    </form>
  );
}

function DiscountForm({ dentist, current, onDone }: { dentist: Dentist; current: number | null; onDone: () => void }) {
  const setDiscount = useSetDiscount();
  const [value, setValue] = useState(current === null ? '0' : String(current));
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <form
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const pct = parsePercentInput(value);
        if (pct === null) {
          setError(t('money.pricing.errors.invalidPercent'));
          inputRef.current?.focus();
          return;
        }
        setError(undefined);
        try {
          setSaving(true);
          await setDiscount.mutateAsync({ dentist_id: dentist.id, discount_percent: pct });
          toast.success(t('money.pricing.toasts.discountSaved', { name: dentist.name }));
          onDone();
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setSaving(false);
        }
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('money.pricing.discountDialog.title', { name: dentist.name })}</DialogTitle>
        <DialogDescription>{t('money.pricing.discountDialog.description')}</DialogDescription>
      </DialogHeader>
      <Input
        ref={inputRef}
        label={t('money.pricing.discountDialog.label')}
        inputMode="decimal"
        dir="ltr"
        autoComplete="off"
        value={value}
        error={error}
        onChange={(e) => setValue(e.target.value)}
      />
      <FormFooter onCancel={onDone} saving={saving} saveLabel={t('common.actions.save')} />
    </form>
  );
}

function OpeningForm({ dentist, current, onDone }: {
  dentist: Dentist;
  current: DentistOpeningBalance | null;
  onDone: () => void;
}) {
  const setOpening = useSetOpeningBalance();
  const deleteOpening = useDeleteOpeningBalance();
  const today = cairoToday();
  const [amount, setAmount] = useState(current ? String(current.amount) : '');
  const [asOf, setAsOf] = useState(current?.as_of ?? today);
  const [note, setNote] = useState(current?.note ?? '');
  const [errors, setErrors] = useState<{ amount?: string; asOf?: string }>({});
  const [saving, setSaving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const asOfRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async () => {
    const parsed = parseMoneyInput(amount);
    const next: { amount?: string; asOf?: string } = {};
    if (parsed === null) next.amount = t('money.pricing.errors.invalidAmount');
    else if (/^-?0\.00$/.test(parsed)) next.amount = t('money.pricing.errors.zeroAmount');
    if (!asOf) next.asOf = t('money.pricing.errors.dateRequired');
    else if (asOf > today) next.asOf = t('money.pricing.errors.futureDate');
    setErrors(next);
    if (next.amount) amountRef.current?.focus();
    else if (next.asOf) asOfRef.current?.focus();
    if (next.amount || next.asOf || parsed === null) return;
    try {
      setSaving(true);
      await setOpening.mutateAsync({ dentist_id: dentist.id, amount: parsed, as_of: asOf, note: note.trim() || null });
      toast.success(t('money.pricing.toasts.openingSaved', { name: dentist.name }));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    try {
      setSaving(true);
      await deleteOpening.mutateAsync(dentist.id);
      toast.success(t('money.pricing.toasts.openingRemoved', { name: dentist.name }));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void handleSubmit();
      }}
    >
      <DialogHeader>
        <DialogTitle>{t('money.pricing.openingDialog.title', { name: dentist.name })}</DialogTitle>
        <DialogDescription>{t('money.pricing.openingDialog.description')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <Input
          ref={amountRef}
          label={t('money.pricing.openingDialog.amount')}
          helperText={t('money.pricing.openingDialog.amountHelp')}
          inputMode="decimal"
          dir="ltr"
          autoComplete="off"
          value={amount}
          error={errors.amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input
          ref={asOfRef}
          type="date"
          label={t('money.pricing.openingDialog.asOf')}
          max={today}
          value={asOf}
          error={errors.asOf}
          onChange={(e) => setAsOf(e.target.value)}
        />
        <Textarea
          label={t('money.pricing.openingDialog.note')}
          value={note}
          maxLength={2000}
          onChange={(e) => setNote(e.target.value)}
        />
        {current && !confirmRemove && (
          <Button type="button" variant="outline" className="w-full min-h-11 text-[var(--destructive)]" onClick={() => setConfirmRemove(true)}>
            {t('money.pricing.openingDialog.remove')}
          </Button>
        )}
        {current && confirmRemove && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 space-y-3" role="alert">
            <p className="text-sm text-red-800">{t('money.pricing.openingDialog.removeConfirm')}</p>
            <div className="flex gap-2 *:min-h-11 *:flex-1">
              <Button type="button" variant="ghost" onClick={() => setConfirmRemove(false)}>
                {t('common.actions.cancel')}
              </Button>
              <Button type="button" variant="destructive" loading={saving} onClick={handleRemove}>
                {t('common.actions.confirm')}
              </Button>
            </div>
          </div>
        )}
      </div>
      <FormFooter onCancel={onDone} saving={saving} saveLabel={t('common.actions.save')} />
    </form>
  );
}
