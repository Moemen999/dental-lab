/**
 * Money helpers (Egyptian pounds). Amounts come from the database as numeric(12,2)
 * (JSON numbers) and are only DISPLAYED here: totals and balances are computed by
 * the database. Input is parsed as text and sent as a decimal string, so no
 * floating-point arithmetic touches an amount.
 */
import { t } from '@/i18n';

// Left-to-right isolate: keeps "-1,234.50" in one piece inside Arabic text.
const LRI = '⁦';
const PDI = '⁩';

const amountFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

type MoneyValue = number | string | null | undefined;

/** "1,234.50" (Western digits, 2 decimals) or "—". */
export function formatAmount(value: MoneyValue): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '—';
  return amountFormatter.format(n);
}

/** "1,234.50 ج.م" with the number isolated left-to-right, or "—". */
export function formatMoney(value: MoneyValue): string {
  const amount = formatAmount(value);
  if (amount === '—') return amount;
  return `${LRI}${amount}${PDI} ${t('money.currency')}`;
}

/** Arabic-Indic digits and the Arabic decimal/thousands separators to ASCII. */
function normalizeDigits(input: string): string {
  return input
    // Bidi marks / isolates pasted along with a number (e.g. copied from this app).
    .replace(/[‎‏؜‪-‮⁦-⁩]/g, '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/[٬,\s]/g, '');
}

/** Canonical 2-decimal string from a validated decimal string (no arithmetic). */
function toTwoDecimals(sign: string, whole: string, frac: string | undefined): string {
  const w = whole === '' ? '0' : whole.replace(/^0+(?=\d)/, '');
  return `${sign}${w}.${(frac ?? '').padEnd(2, '0')}`;
}

/**
 * Parses what the user typed ("1,500.5", "١٢٣٫٤") into "1500.50".
 * null when it is not an amount with at most 10 whole digits and 2 decimals.
 */
export function parseMoneyInput(input: string, { allowNegative = true }: { allowNegative?: boolean } = {}): string | null {
  // ".5" is accepted as 0.50; "" and "." are not amounts.
  const m = /^(-?)(\d{0,10})(?:\.(\d{1,2}))?$/.exec(normalizeDigits(input.trim()));
  if (!m || (m[2] === '' && m[3] === undefined)) return null;
  if (m[1] && !allowNegative) return null;
  return toTwoDecimals(m[1], m[2], m[3]);
}

/** Discount percent 0–100 with at most 2 decimals, as "12.50". */
export function parsePercentInput(input: string): string | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(normalizeDigits(input.trim()));
  if (!m) return null;
  const value = toTwoDecimals('', m[1], m[2]);
  if (Number(value) > 100) return null;
  return value;
}

/** "-300.00" for 300: the amount of a reversal (sign flip on the text, no arithmetic). */
export function negateAmount(value: number | string): string {
  const parsed = parseMoneyInput(typeof value === 'number' ? value.toFixed(2) : value);
  if (parsed === null) throw new Error('invalid amount');
  return parsed.startsWith('-') ? parsed.slice(1) : `-${parsed}`;
}

/** First and last day of the month that contains `today` (YYYY-MM-DD, Cairo date). */
export function cairoMonthRange(today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const mm = String(m).padStart(2, '0');
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(lastDay).padStart(2, '0')}` };
}
