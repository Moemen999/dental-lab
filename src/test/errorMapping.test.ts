/** Database errors without a HINT that still have a specific Arabic message. */
import { describe, it, expect } from 'vitest';
import { errorMessage } from '@/i18n/errors';
import { ar } from '@/i18n/ar';

describe('errorMessage: unique violations', () => {
  it('a second reversal of a payment (unique index payments_one_reversal) says "already reversed"', () => {
    const e = { code: '23505', message: 'duplicate key value violates unique constraint "payments_one_reversal"', details: 'Key (reverses_payment_id)=(x) already exists.' };
    expect(errorMessage(e)).toBe(ar.errors.db['err.payment.already_reversed']);
  });

  it('other duplicates keep the generic message', () => {
    expect(errorMessage({ code: '23505', message: 'duplicate key value violates unique constraint "work_types_name_unique"' }))
      .toBe(ar.errors.generic.duplicate);
  });
});
