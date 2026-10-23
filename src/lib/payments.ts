/**
 * A payment is inserted with an id generated ONCE when the payment dialog opens.
 * If the same insert reaches the database twice (double click, retry after a lost
 * response), the second one hits the primary key: the payment already exists, so
 * it is treated as success and no second payment is created.
 */
export function newPaymentId(): string {
  return crypto.randomUUID();
}

export function isDuplicatePaymentId(error: unknown): boolean {
  const e = (error ?? {}) as { code?: unknown; message?: unknown; details?: unknown };
  if (e.code !== '23505') return false;
  const text = `${String(e.message ?? '')} ${String(e.details ?? '')}`;
  return text.includes('payments_pkey');
}
