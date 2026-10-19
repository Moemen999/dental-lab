// @vitest-environment node
/**
 * Arabic translation coverage:
 * - every literal t('...') / tx('...') key used in src/ exists in the dictionary
 * - every err.* key the database can return (HINT in supabase/migrations) has an Arabic message
 * - errorMessage() never leaks raw English
 * - index.html is Arabic + RTL and its <title> matches the dictionary
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { ar } from '@/i18n/ar';
import { lookup } from '@/i18n';
import { errorMessage } from '@/i18n/errors';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const SRC = path.join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'test') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = walk(SRC).filter((f) => !f.includes(`${path.sep}i18n${path.sep}`));

function flatten(obj: unknown, prefix = ''): Array<[key: string, value: string]> {
  if (typeof obj === 'string') return [[prefix, obj]];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}

const LATIN = /[A-Za-z]/;

describe('translation keys used in code', () => {
  const used = new Map<string, string>();
  const dynamicCalls: string[] = [];

  for (const file of sourceFiles) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\b(?:t|tx)\(\s*(['"`])([^'"`]+)\1/g)) {
      used.set(m[2], path.relative(ROOT, file));
    }
    // t(someVariable) cannot be checked statically: forbid it outside src/i18n.
    for (const m of text.matchAll(/\b(?:t|tx)\(\s*([A-Za-z_][\w.]*)\s*[,)]/g)) {
      dynamicCalls.push(`${path.relative(ROOT, file)}: t(${m[1]})`);
    }
  }

  it('finds translation calls in the code', () => {
    expect(used.size).toBeGreaterThan(100);
  });

  it('every key exists in the Arabic dictionary', () => {
    const missing = [...used].filter(([key]) => lookup(key) === undefined).map(([k, f]) => `${k} (${f})`);
    expect(missing).toEqual([]);
  });

  it('no dynamic (non-literal) translation keys', () => {
    expect(dynamicCalls).toEqual([]);
  });
});

describe('no hardcoded English in the UI', () => {
  const tsxFiles = sourceFiles.filter((f) => f.endsWith('.tsx'));
  const checks: Array<[name: string, re: RegExp]> = [
    // Text between JSX tags, e.g. <span>Save</span> (lines with code punctuation are skipped)
    ['JSX text', />\s*[^<>{}()=;:]*[A-Za-z]{2,}[^<>{}()=;:]*<\//],
    // User-facing attributes with literal English
    ['attribute', /\b(?:placeholder|title|aria-label|label|actionLabel|description|alt)="[^"]*[A-Za-z][^"]*"/],
    // Literal toast messages
    ['toast', /toast\.(?:success|error|info|warning)\(\s*['"`]/],
  ];

  it('has no literal English text, labels or toasts in components', () => {
    const offenders: string[] = [];
    for (const file of tsxFiles) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        for (const [name, re] of checks) {
          if (re.test(line)) offenders.push(`${path.relative(ROOT, file)}:${i + 1} [${name}] ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('the detector catches English (self-check)', () => {
    expect(checks[0][1].test('<span>Save changes</span>')).toBe(true);
    expect(checks[1][1].test('placeholder="Search..."')).toBe(true);
    expect(checks[2][1].test("toast.error('Failed')")).toBe(true);
    expect(checks[0][1].test('<span>حفظ</span>')).toBe(false);
  });
});

describe('Arabic dictionary content', () => {
  // Values that are intentionally Latin: technical examples typed by users.
  const LATIN_ALLOWED = new Set([
    'common.app.name', // checked separately below; must be Arabic
    'auth.login.emailPlaceholder',
    'batches.createDialog.referencePlaceholder',
    'dentists.dialog.emailPlaceholder',
    'employees.inviteDialog.emailPlaceholder',
  ]);

  it('every value is non-empty Arabic text (except allowed technical examples)', () => {
    const offenders = flatten(ar)
      .filter(([key]) => !LATIN_ALLOWED.has(key))
      .filter(([, value]) => {
        const withoutPlaceholders = value.replace(/\{\w+\}/g, '');
        return value.trim() === '' || (LATIN.test(withoutPlaceholders) && !/[؀-ۿ]/.test(value));
      })
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it('the app name is Arabic', () => {
    expect(ar.common.app.name).toMatch(/[؀-ۿ]/);
  });
});

describe('database error keys', () => {
  const migrationsDir = path.join(ROOT, 'supabase', 'migrations');
  const hintKeys = new Set<string>();
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8');
    for (const m of sql.matchAll(/HINT\s*=\s*'(err\.[a-z0-9_.]+)'/g)) hintKeys.add(m[1]);
  }

  it('finds the err.* keys raised by the migrations', () => {
    expect(hintKeys.size).toBeGreaterThanOrEqual(20);
  });

  it('every err.* key has an Arabic message', () => {
    const db = ar.errors.db as Record<string, string>;
    const missing = [...hintKeys].filter((k) => !db[k]);
    expect(missing).toEqual([]);
  });

  it('errorMessage maps each database error to its Arabic message', () => {
    const db = ar.errors.db as Record<string, string>;
    for (const key of hintKeys) {
      const err = { message: 'English text from Postgres', code: 'P0001', hint: key };
      expect(errorMessage(err)).toBe(db[key]);
    }
  });
});

describe('errorMessage never shows raw English', () => {
  const samples: unknown[] = [
    new Error('Something exploded in English'),
    { message: 'new row violates row-level security policy', code: '42501' },
    { message: 'duplicate key value violates unique constraint', code: '23505' },
    { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' },
    { message: 'Invalid login credentials', name: 'AuthApiError', status: 400 },
    { message: 'Edge Function returned a non-2xx status code', name: 'FunctionsHttpError' },
    new TypeError('Failed to fetch'),
    { message: 'x', hint: 'err.unknown.key' },
    'plain string error',
    null,
    undefined,
  ];

  it.each(samples.map((s, i) => [i, s]))('sample %i returns Arabic only', (_i, sample) => {
    const msg = errorMessage(sample);
    expect(msg).toMatch(/[؀-ۿ]/);
    expect(msg).not.toMatch(LATIN);
  });

  it('unknown errors fall back to the generic message', () => {
    expect(errorMessage(new Error('boom'))).toBe(ar.errors.generic.unknown);
  });

  it('known codes get specific messages', () => {
    expect(errorMessage({ code: '42501' })).toBe(ar.errors.generic.permissionDenied);
    expect(errorMessage({ code: 'invalid_credentials' })).toBe(ar.errors.auth.invalidCredentials);
  });
});

describe('HTML shell', () => {
  const html = readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  it('is Arabic and right-to-left', () => {
    expect(html).toMatch(/<html[^>]*\blang="ar"/);
    expect(html).toMatch(/<html[^>]*\bdir="rtl"/);
  });

  it('<title> matches the dictionary', () => {
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1];
    expect(title).toBe(ar.common.app.title);
  });
});
