import { useSyncExternalStore } from 'react';
import { useI18nStore, type Language } from '@/stores/i18nStore';
import type { Translations } from './en';

// Lazy-load translation bundles so only the active language is in memory.
// Non-English bundles are partial — missing keys fall back to English at runtime.
// The `as Translations` cast is safe because `useTranslation()` merges with `en`.
const loaders: Record<Language, () => Promise<Translations>> = {
  en: () => import('./en').then(m => m.en),
  zh: () => import('./zh').then(m => m.zh as unknown as Translations),
  ar: () => import('./ar').then(m => m.ar as unknown as Translations),
  hi: () => import('./hi').then(m => m.hi as unknown as Translations),
  ru: () => import('./ru').then(m => m.ru as unknown as Translations),
  id: () => import('./id').then(m => m.id as unknown as Translations),
  es: () => import('./es').then(m => m.es as unknown as Translations),
  fr: () => import('./fr').then(m => m.fr as unknown as Translations),
  bn: () => import('./bn').then(m => m.bn as unknown as Translations),
  ja: () => import('./ja').then(m => m.ja as unknown as Translations),
  vi: () => import('./vi').then(m => m.vi as unknown as Translations),
  de: () => import('./de').then(m => m.de as unknown as Translations),
  ko: () => import('./ko').then(m => m.ko as unknown as Translations),
  cs: () => import('./cs').then(m => m.cs as unknown as Translations),
};

// Cache loaded bundles so we don't re-import on every render.
const cache = new Map<Language, Translations>();

// English is always available synchronously as the fallback.
import { en } from './en';
cache.set('en', en);

/** Recursively merge two plain objects — `overlay` wins at leaf level, `base` fills gaps. */
function deepMerge(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(overlay)) {
    const bVal = base[key];
    const oVal = overlay[key];
    if (
      oVal && typeof oVal === 'object' && !Array.isArray(oVal) &&
      bVal && typeof bVal === 'object' && !Array.isArray(bVal)
    ) {
      out[key] = deepMerge(bVal as Record<string, unknown>, oVal as Record<string, unknown>);
    } else if (oVal !== undefined) {
      out[key] = oVal;
    }
  }
  return out;
}

/** Deep-merge a partial translation bundle with the English fallback (all nesting levels). */
function mergeWithFallback(partial: Translations): Translations {
  return deepMerge(en as Record<string, unknown>, partial as unknown as Record<string, unknown>) as Translations;
}

const loadingSet = new Set<Language>();

/** Eagerly load a language bundle into cache with retry on failure. */
function preload(lang: Language) {
  if (cache.has(lang) || loadingSet.has(lang)) return;
  loadingSet.add(lang);

  const attempt = (isRetry: boolean) => {
    loaders[lang]()
      .then(bundle => {
        cache.set(lang, lang === 'en' ? bundle : mergeWithFallback(bundle));
        bundleVersion++;
        listeners.forEach(fn => fn());
      })
      .catch((err: unknown) => {
        if (!isRetry) {
          console.warn(`[i18n] Failed to load "${lang}" bundle, retrying...`, err);
          setTimeout(() => attempt(true), 1000);
          return;
        }
        import('@/lib/log').then(({ createLogger }) => {
          createLogger('i18n').error(`Failed to load "${lang}" bundle after retry — falling back to English`, { error: err instanceof Error ? err.message : String(err) });
        });
      })
      .finally(() => {
        loadingSet.delete(lang);
      });
  };

  attempt(false);
}

// Tiny pub-sub so React hooks re-render when a bundle finishes loading.
const listeners = new Set<() => void>();
let bundleVersion = 0;

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
}

function getSnapshot(): number {
  return bundleVersion;
}

/**
 * Interpolate `{variable}` placeholders in a translation string.
 *
 * @example
 *   interpolate("You have {count} agents", { count: 3 })
 *   // => "You have 3 agents"
 */
export function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`
  );
}

/**
 * Primary translation hook. Returns the full translation tree for the
 * active language and a helper `tx()` for variable interpolation.
 *
 * Usage:
 *   const { t, tx, language } = useTranslation();
 *   t.common.save             // "Save"
 *   tx(t.common.agent_count_other, { count: 5 })  // "5 agents"
 */
export function useTranslation() {
  const { language } = useI18nStore();
  useSyncExternalStore(subscribe, getSnapshot);

  // Trigger preload if the bundle isn't cached yet.
  if (!cache.has(language)) {
    preload(language);
  }

  // Fall back to English while async bundle loads.
  const bundle = cache.get(language) ?? en;

  return {
    /** Full translation tree for the active language. */
    t: bundle,
    /** Active language code (e.g. "en", "zh", "es"). */
    language,
    /**
     * Interpolate variables into a translation string.
     * @example tx(t.common.agent_count_other, { count: 5 })
     */
    tx: interpolate,
  };
}
