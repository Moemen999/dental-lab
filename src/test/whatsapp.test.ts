import { describe, it, expect } from 'vitest';
import {
  normalizeEgyptPhone,
  classifyEgyptPhone,
  buildDoctorMessage,
  buildWaLink,
  cairoToday,
  doctorGreeting,
} from '@/lib/whatsapp';
import { formatDate } from '@/lib/utils';

describe('normalizeEgyptPhone', () => {
  it.each([
    ['01012345678', '201012345678'],
    ['+20 101 234 5678', '201012345678'],
    ['0020-10-1234-5678', '201012345678'],
    ['201012345678', '201012345678'],
    ['1012345678', '201012345678'],
    ['٠١٠١٢٣٤٥٦٧٨', '201012345678'],
    ['۰۱۰۱۲۳۴۵۶۷۸', '201012345678'],
    ['01112345678', '201112345678'],
    ['01212345678', '201212345678'],
    ['01512345678', '201512345678'],
    [' (010) 1234-5678 ', '201012345678'],
    ['+20 010 1234 5678', '201012345678'],
    ['0020 010 1234 5678', '201012345678'],
    ['20 010 1234 5678', '201012345678'],
  ])('accepts %s', (raw, expected) => {
    expect(normalizeEgyptPhone(raw)).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['0223456789'],
    ['+20 2 2345 6789'],
    ['0101234567'],
    ['010123456789'],
    ['01312345678'],
    ['01412345678'],
    ['0101234567a'],
    ['phone'],
    ['+971 4 000 2222'],
    ['010+12345678'],
    ['+20 02 2345 6789'],
    ['0020 013 1234 5678'],
    ['+20 0010 1234 5678'],
  ])('rejects %j', (raw) => {
    expect(normalizeEgyptPhone(raw)).toBeNull();
  });

  it('rejects null and undefined', () => {
    expect(normalizeEgyptPhone(null)).toBeNull();
    expect(normalizeEgyptPhone(undefined)).toBeNull();
  });

  it('a valid result is always 20 + 10 digits starting with 10/11/12/15', () => {
    for (const raw of ['01012345678', '+20 115 000 1111', '٠١٢٣٤٥٦٧٨٩٠', '0020 15 1234 5678']) {
      expect(normalizeEgyptPhone(raw)).toMatch(/^201[0125]\d{8}$/);
    }
  });
});

describe('classifyEgyptPhone', () => {
  it.each([['01012345678'], ['+20 115 000 1111'], ['0020 010 1234 5678']])('%s is a mobile', (raw) => {
    expect(classifyEgyptPhone(raw)).toBe('mobile');
  });

  it.each([[''], ['   '], [null], [undefined]])('%j is missing', (raw) => {
    expect(classifyEgyptPhone(raw)).toBe('missing');
  });

  it.each([
    ['0223456789'], // Cairo
    ['02 2345 6789'],
    ['+20 2 2345 6789'],
    ['0020 2 2345 6789'],
    ['+20 02 2345 6789'],
    ['035456789'], // Alexandria
    ['0403123456'], // Tanta
    ['٠٢٢٣٤٥٦٧٨٩'],
  ])('%s is a landline', (raw) => {
    expect(classifyEgyptPhone(raw)).toBe('landline');
  });

  it('ignores invisible direction marks pasted with the number', () => {
    expect(classifyEgyptPhone('‎01012345678')).toBe('mobile');
    expect(classifyEgyptPhone('‪+20 101 234 5678‬')).toBe('mobile');
    expect(classifyEgyptPhone('⁦٠١٠١٢٣٤٥٦٧٨⁩')).toBe('mobile');
    expect(normalizeEgyptPhone('‏01012345678')).toBe('201012345678');
    expect(classifyEgyptPhone('‎0223456789')).toBe('landline');
  });

  it.each([['01312345678'], ['0101234567'], ['phone'], ['+971 4 000 2222'], ['+20 0010 1234 5678'], ['010+12345678'],
    ['+1012345678'], ['+0 1012345678'], ['+1 202 555 0100']])(
    '%s is invalid',
    (raw) => {
      expect(classifyEgyptPhone(raw)).toBe('invalid');
    },
  );
});

describe('doctorGreeting', () => {
  it.each([
    // Stored name already has an Arabic title: keep it as stored, add nothing.
    ['د. منى السيد', 'السلام عليكم د. منى السيد'],
    ['د.منى', 'السلام عليكم د.منى'],
    ['د/ سامي حسن', 'السلام عليكم د/ سامي حسن'],
    ['دكتور أحمد علي', 'السلام عليكم دكتور أحمد علي'],
    ['دكتورة منى', 'السلام عليكم دكتورة منى'],
    ['  دكتور   أحمد  ', 'السلام عليكم دكتور أحمد'],
    // No title (or an English one): add "د.".
    ['منى السيد', 'السلام عليكم د. منى السيد'],
    ['Dr. Sarah Clark', 'السلام عليكم د. Sarah Clark'],
    ['dr.Sarah', 'السلام عليكم د. Sarah'],
    ['Drew Smith', 'السلام عليكم د. Drew Smith'],
    ['دكتورى', 'السلام عليكم د. دكتورى'],
    // No usable name.
    ['', 'السلام عليكم دكتور'],
    [null, 'السلام عليكم دكتور'],
    ['  ', 'السلام عليكم دكتور'],
    ['دكتور', 'السلام عليكم دكتور'],
    ['دكتورة', 'السلام عليكم دكتورة'],
    ['Dr.', 'السلام عليكم دكتور'],
  ])('%j -> %s', (raw, expected) => {
    expect(doctorGreeting(raw)).toBe(expected);
  });

  it.each([
    // More ways the title is typed in Egypt: kept as stored.
    ['دكتوره منى', 'السلام عليكم دكتوره منى'],
    ['الدكتور أحمد', 'السلام عليكم الدكتور أحمد'],
    ['أ.د. محمد علي', 'السلام عليكم أ.د. محمد علي'],
    ['ا.د/ محمد', 'السلام عليكم ا.د/ محمد'],
    ['دكتور/ أحمد', 'السلام عليكم دكتور/ أحمد'],
    ['دكتور.أحمد', 'السلام عليكم دكتور.أحمد'],
    ['د أحمد', 'السلام عليكم د أحمد'],
    ['د / منى', 'السلام عليكم د / منى'],
    // Names that only start with the letter د are not titles.
    ['دعاء حسن', 'السلام عليكم د. دعاء حسن'],
    ['داليا', 'السلام عليكم د. داليا'],
    ['ضياء', 'السلام عليكم د. ضياء'],
    // A title alone.
    ['د', 'السلام عليكم دكتور'],
    ['د.', 'السلام عليكم دكتور'],
    ['دكتوره', 'السلام عليكم دكتورة'],
    ['دكتور/', 'السلام عليكم دكتور'],
  ])('%j -> %s', (raw, expected) => {
    expect(doctorGreeting(raw)).toBe(expected);
  });

  it('ignores invisible direction marks pasted with the name', () => {
    expect(doctorGreeting('‏د. منى')).toBe('السلام عليكم د. منى');
    expect(doctorGreeting('⁧دكتور أحمد⁩')).toBe('السلام عليكم دكتور أحمد');
  });

  it('never doubles the title', () => {
    for (const name of ['د. منى', 'د.منى', 'د/ منى', 'دكتور منى', 'دكتورة منى', 'دكتوره منى', 'الدكتور منى', 'أ.د. منى', 'دكتور/ منى']) {
      expect(doctorGreeting(name)).not.toMatch(/د\.\s*(د[./\s]|دكتور|الدكتور|[أا]\.?د)/);
    }
  });
});

describe('buildDoctorMessage', () => {
  const date = formatDate('2026-10-18');

  it('late message (exact text, with patient name)', () => {
    expect(
      buildDoctorMessage({
        doctorName: 'د. منى السيد',
        caseNumber: 'CASE-202610-00001',
        patientName: 'مريض تجريبي',
        dueDate: '2026-10-18',
        bucket: 'late',
      }),
    ).toBe(
      'السلام عليكم د. منى السيد\n' +
        'معكم معمل دولفين لتقويم الأسنان.\n' +
        `بخصوص الحالة رقم CASE-202610-00001 (اسم المريض: مريض تجريبي)، كان موعد تسليمها ${date}.\n` +
        'نعتذر عن التأخير، وسنتواصل معكم لتأكيد موعد التسليم الجديد.',
    );
  });

  it('today message (exact text, with patient name)', () => {
    expect(
      buildDoctorMessage({
        doctorName: 'Dr. Sarah Clark',
        caseNumber: 'CASE-202610-00002',
        patientName: 'Fake Patient',
        dueDate: '2026-10-18',
        bucket: 'today',
      }),
    ).toBe(
      'السلام عليكم د. Sarah Clark\n' +
        'معكم معمل دولفين لتقويم الأسنان.\n' +
        `بخصوص الحالة رقم CASE-202610-00002 (اسم المريض: Fake Patient)، موعد تسليمها اليوم ${date}.\n` +
        'سنتواصل معكم لتأكيد وقت التسليم.',
    );
  });

  it('keeps a stored "دكتور" title without adding "د."', () => {
    const msg = buildDoctorMessage({ doctorName: 'دكتور أحمد', caseNumber: 'C', patientName: 'P', dueDate: '2026-10-18', bucket: 'late' });
    expect(msg.split('\n')[0]).toBe('السلام عليكم دكتور أحمد');
  });

  it('always names the patient (owner decision); no empty brackets without a name', () => {
    for (const bucket of ['late', 'today'] as const) {
      const msg = buildDoctorMessage({ doctorName: 'منى', caseNumber: 'C', patientName: 'سارة علي', dueDate: '2026-10-18', bucket });
      expect(msg).toContain('(اسم المريض: سارة علي)');
      for (const patientName of ['', '   ', null, undefined]) {
        const m = buildDoctorMessage({ doctorName: 'منى', caseNumber: 'C', patientName, dueDate: '2026-10-18', bucket });
        expect(m).not.toMatch(/اسم المريض|\(\s*\)/);
        expect(m).toContain('رقم C،');
      }
    }
  });

  it('the date is the Arabic formatted due date', () => {
    expect(date).toBe('18 أكتوبر 2026');
  });

  it('contains no invisible direction marks', () => {
    const msg = buildDoctorMessage({ doctorName: 'منى', caseNumber: 'C', patientName: 'P', dueDate: '2026-10-18', bucket: 'late' });
    expect(msg).not.toMatch(/[⁦-⁩‎‏]/);
  });
});

describe('buildWaLink', () => {
  it('builds a wa.me link with the encoded text', () => {
    const text = 'السلام عليكم\nسطر 2 & ?';
    expect(buildWaLink('01012345678', text)).toBe(`https://wa.me/201012345678?text=${encodeURIComponent(text)}`);
  });
  it('returns null for a landline, an invalid or a missing phone', () => {
    expect(buildWaLink('0223456789', 'x')).toBeNull();
    expect(buildWaLink('01312345678', 'x')).toBeNull();
    expect(buildWaLink(null, 'x')).toBeNull();
    expect(buildWaLink('', 'x')).toBeNull();
  });
});

describe('cairoToday', () => {
  it('00:30 Cairo on 1 November (UTC+2) is 1 November', () => {
    expect(cairoToday(new Date('2026-10-31T22:30:00Z'))).toBe('2026-11-01');
  });
  it('23:30 Cairo on 31 October is 31 October', () => {
    expect(cairoToday(new Date('2026-10-31T21:30:00Z'))).toBe('2026-10-31');
  });
  it('summer time (UTC+3): 00:30 on 1 July is 1 July', () => {
    expect(cairoToday(new Date('2026-06-30T21:30:00Z'))).toBe('2026-07-01');
  });
  it('summer time: 23:30 on 30 June is 30 June', () => {
    expect(cairoToday(new Date('2026-06-30T20:30:00Z'))).toBe('2026-06-30');
  });
});
