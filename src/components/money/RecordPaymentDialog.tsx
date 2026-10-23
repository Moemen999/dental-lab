import { useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useDentistCases, useRecordPayment } from '@/hooks/useSupabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { formatMoney, parseMoneyInput } from '@/lib/money';
import { newPaymentId } from '@/lib/payments';
import { ar } from '@/i18n/ar';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import type { PaymentMethod } from '@/types/database';

const METHODS = Object.keys(ar.money.method) as PaymentMethod[];

// Bidi isolates for "CASE-… — name" inside the RTL option list.
const LRI = '⁦';
const FSI = '⁨';
const PDI = '⁩';

/** True when PostgREST / Postgres answered with an error (code or hint): the insert was rolled back. */
function isDatabaseAnswer(err: unknown): boolean {
  const e = (err ?? {}) as { code?: unknown; hint?: unknown };
  return (typeof e.code === 'string' && e.code !== '') || (typeof e.hint === 'string' && e.hint !== '');
}

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dentistId: string;
  dentistName: string;
  /** Payment for this case only (case page): no case picker. */
  caseId?: string;
}

/** Owner / receptionist: record a payment from a doctor (per case or on account). */
export function RecordPaymentDialog({ open, onOpenChange, dentistId, dentistName, caseId }: RecordPaymentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {/* Mounted only while open: each opening gets its own payment id. */}
        <PaymentForm dentistId={dentistId} dentistName={dentistName} caseId={caseId} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function PaymentForm({ dentistId, dentistName, caseId, onDone }: {
  dentistId: string;
  dentistName: string;
  caseId?: string;
  onDone: () => void;
}) {
  // Generated ONCE per opening and sent with every attempt: a double submit or a retry
  // after a lost response hits the primary key instead of creating a second payment.
  const [paymentId] = useState(newPaymentId);
  const recordPayment = useRecordPayment();
  const { data: cases } = useDentistCases(dentistId, !caseId);
  const amountRef = useRef<HTMLInputElement>(null);
  // Synchronous guard: a state update is not visible to a second click in the same tick.
  const inFlight = useRef(false);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [selectedCase, setSelectedCase] = useState('');
  const [note, setNote] = useState('');
  const [amountError, setAmountError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  // Once a request was sent, this id may already be stored with these values: a retry
  // must send exactly the same payment, so the fields are locked.
  const [sent, setSent] = useState(false);
  // The last attempt ended without a database answer (network / unknown).
  const [maybeSaved, setMaybeSaved] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (inFlight.current) return;
    const parsed = parseMoneyInput(amount, { allowNegative: false });
    if (parsed === null || parsed === '0.00') {
      setAmountError(t('money.payment.invalidAmount'));
      amountRef.current?.focus();
      return;
    }
    setAmountError(undefined);
    inFlight.current = true;
    setSaving(true);
    setSent(true);
    setMaybeSaved(false);
    try {
      const result = await recordPayment.mutateAsync({
        id: paymentId,
        dentist_id: dentistId,
        case_id: caseId ?? (selectedCase || null),
        amount: parsed,
        method,
        note: note.trim() || null,
      });
      // On a duplicate id the hook reads the stored payment back: show what is saved.
      toast.success(t('money.payment.saved', { amount: formatMoney(result?.amount ?? parsed) }));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
      if (isDatabaseAnswer(err)) {
        // The database answered and rolled back: nothing was saved, fields can change.
        setSent(false);
      } else {
        // No answer: the payment may be stored under this id. Keep the same values.
        setMaybeSaved(true);
      }
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <DialogHeader>
        <DialogTitle>
          {dentistName.trim() ? t('money.payment.title', { name: dentistName }) : t('money.payment.titleNoName')}
        </DialogTitle>
        <DialogDescription>{t('money.payment.description')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <Input
          ref={amountRef}
          label={t('money.payment.amount')}
          inputMode="decimal"
          autoComplete="off"
          dir="ltr"
          value={amount}
          error={amountError}
          disabled={sent}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Select
          label={t('money.payment.method')}
          value={method}
          disabled={sent}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {ar.money.method[m]}
            </option>
          ))}
        </Select>
        {!caseId && (
          <Select
            label={t('money.payment.case')}
            value={selectedCase}
            disabled={sent}
            onChange={(e) => setSelectedCase(e.target.value)}
          >
            <option value="">{t('money.payment.noCase')}</option>
            {(cases ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {`${LRI}${c.case_number}${PDI} — ${FSI}${c.patient_name}${PDI}`}
              </option>
            ))}
          </Select>
        )}
        <Textarea
          label={t('money.payment.note')}
          value={note}
          maxLength={2000}
          disabled={sent}
          onChange={(e) => setNote(e.target.value)}
        />
        {sent && maybeSaved && (
          <p className="text-sm text-amber-800" role="status">{t('money.payment.lockedNote')}</p>
        )}
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t('common.actions.cancel')}
        </Button>
        <Button type="submit" loading={saving}>
          {t('money.payment.submit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
