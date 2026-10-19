import { ar, type Dictionary } from './ar';

// Dotted paths to every string in the dictionary, e.g. 'cases.list.title'.
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type TranslationKey = Leaves<Dictionary>;
export type TranslationParams = Record<string, string | number>;

// Unicode First-Strong Isolate / Pop Directional Isolate: keeps an inserted value
// (case number, English name, phone) from reordering the surrounding Arabic text.
const FSI = '⁨';
const PDI = '⁩';

export function lookup(key: string): string | undefined {
  let node: unknown = ar;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Translate a key. `{name}` placeholders are replaced and direction-isolated. */
export function t(key: TranslationKey, params?: TranslationParams): string {
  const template = lookup(key);
  if (template === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`);
    return key;
  }
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? `${FSI}${params[name]}${PDI}` : match,
  );
}

export { ar };
