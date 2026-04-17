import { useSyncExternalStore } from 'react';
import { useI18nStore, type Language } from '@/stores/i18nStore';
import enBundle from './locales/en.json';
import type { Translations } from './generated/types';

/**
 * Per-locale JSON modules, discovered by Vite's import.meta.glob.
 * Each locale is its own async chunk — only the active locale + English
 * ship in the initial bundle.
 *
 * The `import: 'default'` option returns the JSON's default export
 * directly (rather than a module wrapper). `eager: false` keeps each
 * locale lazily code-split.
 */
const localeLoaders = import.meta.glob<{ default: Translations }>('./locales/*.json', {
  eager: false,
});

/** Extract the locale code from a glob path like `./locales/de.json`. */
function codeFromPath(path: string): string {
  return path.replace(/^\.\/locales\//, '').replace(/\.json$/, '');
}

/** Fully-loaded bundles keyed by language code. English is always present. */
const cache = new Map<Language, Translations>();
cache.set('en', enBundle as Translations);

const loadingSet = new Set<Language>();

/**
 * Kick off loading a locale if it isn't cached. Fires a listener broadcast
 * once the bundle resolves so useSyncExternalStore re-renders consumers.
 */
function preload(lang: Language) {
  if (cache.has(lang) || loadingSet.has(lang)) return;

  const entry = Object.entries(localeLoaders).find(([path]) => codeFromPath(path) === lang);
  if (!entry) {
    // Unknown locale — fall back to English silently. The manifest/TS
    // types should prevent this at compile time.
    return;
  }
  const [, loader] = entry;
  loadingSet.add(lang);

  const attempt = (isRetry: boolean): void => {
    loader()
      .then((mod) => {
        // Locales ship at 100% coverage (enforced by `npm run check:i18n`),
        // so the raw bundle is cached as-is with no English fallback merge.
        cache.set(lang, mod.default);
        bundleVersion++;
        listeners.forEach((fn) => fn());
      })
      .catch((err: unknown) => {
        if (!isRetry) {
          setTimeout(() => attempt(true), 1000);
          return;
        }
        import('@/lib/log').then(({ createLogger }) => {
          createLogger('i18n').error(
            `Failed to load "${lang}" locale after retry — falling back to English`,
            { error: err instanceof Error ? err.message : String(err) },
          );
        });
      })
      .finally(() => {
        loadingSet.delete(lang);
      });
  };

  attempt(false);
}

// -- pub/sub so React re-renders when a bundle finishes loading ----------
const listeners = new Set<() => void>();
let bundleVersion = 0;

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
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
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`,
  );
}

/**
 * Primary translation hook. Returns the full translation tree for the
 * active language plus a helper `tx()` for variable interpolation.
 *
 * Every locale ships a full translation — there is no English-fallback
 * deep-merge. If a locale file is missing keys, the coverage gate in
 * `npm run check:i18n` fails CI.
 *
 * Usage:
 *   const { t, tx, language } = useTranslation();
 *   t.common.save                                // "Save"
 *   tx(t.common.agent_count_other, { count: 5 }) // "5 agents"
 */
export function useTranslation() {
  const { language } = useI18nStore();
  useSyncExternalStore(subscribe, getSnapshot);

  if (!cache.has(language)) {
    preload(language);
  }

  // While the async bundle for a non-English locale loads, render English
  // so the UI doesn't flash empty. Swap in the real bundle once ready.
  const bundle = cache.get(language) ?? cache.get('en')!;

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
