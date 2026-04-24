/**
 * Dev-only pseudo-locale. Wraps every translated string in brackets and
 * replaces ASCII letters with accented look-alikes so hardcoded English
 * becomes immediately visible on screen — it's the only thing NOT bracketed.
 *
 * Activation (dev builds only):
 *   - URL param: `?pseudo=1` (persists to localStorage for subsequent loads)
 *   - URL param: `?pseudo=0` disables and clears the flag
 *   - Console: `window.__togglePseudoLocale__()`
 *
 * The pseudo bundle is synthesized at runtime by transforming the English
 * bundle, so there is no JSON file to maintain and the coverage gate is
 * unaffected.
 */
import type { Translations } from './generated/types';

const LS_KEY = 'personas-pseudo-locale';

const ACCENT_MAP: Record<string, string> = {
  a: 'à', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ğ', h: 'ĥ', i: 'ï',
  j: 'ĵ', k: 'ķ', l: 'ľ', m: 'ɱ', n: 'ñ', o: 'ö', p: 'þ', q: 'ǫ', r: 'ř',
  s: 'š', t: 'ţ', u: 'ü', v: 'ṽ', w: 'ŵ', x: 'ẋ', y: 'ÿ', z: 'ž',
  A: 'À', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'Ƒ', G: 'Ğ', H: 'Ĥ', I: 'Ï',
  J: 'Ĵ', K: 'Ķ', L: 'Ľ', M: 'Ṁ', N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Ǫ', R: 'Ř',
  S: 'Š', T: 'Ţ', U: 'Ü', V: 'Ṽ', W: 'Ŵ', X: 'Ẋ', Y: 'Ÿ', Z: 'Ž',
};

/**
 * Accent every ASCII letter, but leave `{placeholder}` tokens untouched so
 * runtime interpolation still works. Wraps the result with ⟦ ⟧ brackets.
 */
function accentuate(input: string): string {
  let out = '';
  let i = 0;
  while (i < input.length) {
    const ch = input[i]!;
    if (ch === '{') {
      const end = input.indexOf('}', i);
      if (end !== -1) {
        out += input.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    out += ACCENT_MAP[ch] ?? ch;
    i++;
  }
  return `⟦${out}⟧`;
}

function transform(value: unknown): unknown {
  if (typeof value === 'string') return accentuate(value);
  if (Array.isArray(value)) return value.map(transform);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = transform(v);
    return out;
  }
  return value;
}

let cached: Translations | null = null;

export function buildPseudoBundle(en: Translations): Translations {
  if (!cached) cached = transform(en) as Translations;
  return cached;
}

/** Read the persisted flag. Safe to call before DOM ready. */
function readFlag(): boolean {
  try {
    return localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeFlag(on: boolean): void {
  try {
    if (on) localStorage.setItem(LS_KEY, '1');
    else localStorage.removeItem(LS_KEY);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

let active = false;

export function isPseudoActive(): boolean {
  return active;
}

/**
 * One-shot boot-time initializer. Reads URL param, reconciles localStorage,
 * exposes a console toggle. No-ops outside dev builds.
 */
export function initPseudoLocale(): void {
  if (!import.meta.env.DEV) return;

  try {
    const param = new URLSearchParams(window.location.search).get('pseudo');
    if (param === '1') writeFlag(true);
    else if (param === '0') writeFlag(false);
  } catch {
    /* URL parsing unavailable — ignore */
  }

  active = readFlag();

  (window as unknown as { __togglePseudoLocale__?: () => boolean }).__togglePseudoLocale__ = () => {
    active = !active;
    writeFlag(active);
    window.location.reload();
    return active;
  };
}
