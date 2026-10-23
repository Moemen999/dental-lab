import { t } from '@/i18n';
import { formatDate } from '@/lib/utils';

export type LateBucket = 'late' | 'today';
export type PhoneKind = 'mobile' | 'landline' | 'missing' | 'invalid';

/** Arabic-Indic (U+0660-0669) and Persian (U+06F0-06F9) digits to Western digits. */
function toWesternDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * The Egyptian national number without country code or trunk 0
 * (mobile '1XXXXXXXXX', landline e.g. '2XXXXXXXX'), or null when the text is not a phone number.
 */
function nationalNumber(raw: string): string | null {
  const s = toWesternDigits(stripDirectionMarks(raw)).trim();
  if (/[^\d\s\-().+]/.test(s) || s.lastIndexOf('+') > 0) return null;
  let digits = s.replace(/\D/g, '');
  // "+" must be followed by Egypt's country code.
  if (s.startsWith('+') && !digits.startsWith('20')) return null;
  if (digits.startsWith('0020')) digits = digits.slice(4);
  else if (s.startsWith('+') && digits.startsWith('20')) digits = digits.slice(2);
  else if (digits.startsWith('20') && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2);
  // National form, or a country code followed by the trunk 0 (+20 010 ...).
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

/** Mobile (010/011/012/015), landline, missing or invalid: decides which warning the page shows. */
export function classifyEgyptPhone(raw: string | null | undefined): PhoneKind {
  if (!raw || !stripDirectionMarks(raw).trim()) return 'missing';
  const n = nationalNumber(raw);
  if (n === null) return 'invalid';
  if (/^1[0125]\d{8}$/.test(n)) return 'mobile';
  // Area code 2 (Cairo) or 3 (Alexandria) + 7-8 digits, or a two-digit area code + 7 digits.
  if (/^[2-9]\d{7,8}$/.test(n)) return 'landline';
  return 'invalid';
}

/**
 * Egyptian mobile number (010/011/012/015) as '20' + 10 digits for wa.me,
 * or null for a landline, a missing or an invalid number.
 */
export function normalizeEgyptPhone(raw: string | null | undefined): string | null {
  return classifyEgyptPhone(raw) === 'mobile' ? `20${nationalNumber(raw!)}` : null;
}

// أ.د. / ا.د/ (professor), د. / د/ / د (alone or before a space),
// دكتور / دكتورة / دكتوره, with or without "ال", followed by a space, "." , "/" or the end.
const ARABIC_TITLE = /^(?:[أا]\.?\s?د\s?[./]|د\s?[./]|د(?=\s|$)|(?:ال)?دكتور[ةه]?(?=[\s./]|$))/;
const FEMALE_TITLE = /^(?:ال)?دكتور[ةه]/;
const ENGLISH_TITLE = /^(?:dr\.|dr(?=\s|$))\s*/i;

/** LRM/RLM, Arabic letter mark and the embedding/isolate controls often pasted from phones. */
function stripDirectionMarks(s: string): string {
  return s.replace(/[‎‏؜‪-‮⁦-⁩]/g, '');
}

/**
 * First line of the message. A stored Arabic title (د. / د/ / دكتور / دكتورة / أ.د. ...) is
 * kept as written and "د." is not added again; an English "Dr." is replaced by "د.".
 */
export function doctorGreeting(name: string | null | undefined): string {
  const n = stripDirectionMarks(name ?? '').trim().replace(/\s+/g, ' ');
  const rest = (title: RegExp) => n.replace(title, '').replace(/^[\s./]+/, '');
  if (!n || rest(ARABIC_TITLE) === '' || rest(ENGLISH_TITLE) === '') {
    return FEMALE_TITLE.test(n) ? t('lateCases.message.greetingTitleFemale') : t('lateCases.message.greetingNoName');
  }
  if (ARABIC_TITLE.test(n)) return fill(t('lateCases.message.greetingTitled'), { doctor: n });
  return fill(t('lateCases.message.greeting'), { doctor: n.replace(ENGLISH_TITLE, '').trim() });
}

function fill(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? params[k] : m));
}

export interface DoctorMessageInput {
  doctorName: string | null | undefined;
  caseNumber: string;
  patientName: string | null | undefined;
  dueDate: string;
  bucket: LateBucket;
}

/**
 * The WhatsApp text for the doctor (templates: lateCases.message in the i18n dictionary).
 * It names the patient, because the doctor does not know the lab's case numbers.
 * Plain substitution, without the direction-isolate marks t() adds to parameters.
 */
export function buildDoctorMessage({ doctorName, caseNumber, patientName, dueDate, bucket }: DoctorMessageInput): string {
  const patient = stripDirectionMarks(patientName ?? '').trim().replace(/\s+/g, ' ');
  const caseRef = patient ? fill(t('lateCases.message.caseWithPatient'), { caseNumber, patientName: patient }) : caseNumber;
  const template = bucket === 'late' ? t('lateCases.message.late') : t('lateCases.message.today');
  return fill(template, { greeting: doctorGreeting(doctorName), caseRef, date: formatDate(dueDate) });
}

/** https://wa.me/20XXXXXXXXXX?text=... or null when the phone is not a valid Egyptian mobile. */
export function buildWaLink(phone: string | null | undefined, text: string): string | null {
  const normalized = normalizeEgyptPhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

// Moved to @/lib/utils (shared with the money pages); re-exported so existing imports keep working.
export { cairoToday } from '@/lib/utils';
