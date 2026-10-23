import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useReversePayment } from '@/hooks/useSupabase';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { formatMoney, negateAmount } from '@/lib/money';
import { t } from '@/i18n';
import { errorMessage } from '@/i18n/errors';
import type { Money } from '@/types/database';

/**
 * Confirmation before reversing a payment. Payments are never edited or deleted:
 * the database records a new row with minus the amount.
 */
export function ReversePaymentDialog({ payment, onOpenChange }: {
  payment: { id: string; amount: Money } | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!payment} onOpenChange={onOpenChange}>
      <DialogContent>
        {payment && <ReverseForm payment={payment} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ReverseForm({ payment, onDone }: { payment: { id: string; amount: Money }; onDone: () => void }) {
  const reverse = useReversePayment();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const amount = negateAmount(payment.amount);

  const handleConfirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setSaving(true);
      await reverse.mutateAsync({ reverses_payment_id: payment.id, amount, note: note.trim() || null });
      toast.success(t('money.reversal.done'));
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('money.reversal.title')}</DialogTitle>
        <DialogDescription>{t('money.reversal.description', { amount: formatMoney(amount) })}</DialogDescription>
      </DialogHeader>
      <Textarea label={t('money.reversal.note')} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          {t('common.actions.cancel')}
        </Button>
        <Button variant="destructive" onClick={handleConfirm} loading={saving}>
          {t('money.reversal.confirm')}
        </Button>
      </DialogFooter>
    </>
  );
}
