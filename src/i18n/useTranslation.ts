import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useI18nStore, type Language } from '@/stores/i18nStore';
import type { Translations } from './generated/types';
import { buildPseudoBundle, isPseudoActive } from './pseudoLocale';
import {
  ALL_I18N_SECTIONS,
  getEnglishSection,
  getEnglishTranslations,
  isTranslationSection,
  type TranslationSection,
} from './englishSections';
import { useActiveI18nSections } from './routeSections';

export type { Translations };

/**
 * Per-locale/per-section JSON modules, discovered by Vite's import.meta.glob.
 * Each non-English top-level section is its own async chunk; English sections
 * are raw JSON strings parsed on first access so cold start no longer parses
 * the full 500KB+ English bundle.
 *
 * The `import: 'default'` option returns the JSON's default export
 * directly (rather than a module wrapper). `eager: false` keeps each
 * locale lazily code-split.
 */
const sectionLoaders = import.meta.glob<{ default: unknown }>('./section-locales/*/*.json', {
  eager: false,
});
type SectionLoader = () => Promise<{ default: unknown }>;

/** Extract `{ lang, section }` from `./section-locales/de/common.json`. */
function sectionFromPath(path: string): { lang: string; section: string } | null {
  const match = /^\.\/section-locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!match) return null;
  const [, lang, section] = match;
  if (!lang || !section) return null;
  return { lang, section };
}

/** Loaded top-level sections keyed by language code. English lives in englishSections.ts. */
const sectionCache = new Map<Language, Partial<Record<TranslationSection, unknown>>>();
const bundleCache = new Map<Language, Translations>();
const loadingPromises = new Map<string, Promise<void>>();
const sectionLoaderIndex = new Map<string, SectionLoader>();

for (const [path, loader] of Object.entries(sectionLoaders)) {
  const parsed = sectionFromPath(path);
  if (parsed && isTranslationSection(parsed.section)) {
    sectionLoaderIndex.set(
      sectionLoadKey(parsed.lang as Language, parsed.section),
      loader as SectionLoader,
    );
  }
}

function sectionLoadKey(lang: Language, section: TranslationSection): string {
  return `${lang}:${section}`;
}

function getCachedSection(lang: Language, section: TranslationSection): unknown | undefined {
  if (lang === 'en') {
    return getEnglishSection(section);
  }
  return sectionCache.get(lang)?.[section];
}

function cacheSection(lang: Language, section: TranslationSection, value: unknown): void {
  let sections = sectionCache.get(lang);
  if (!sections) {
    sections = {};
    sectionCache.set(lang, sections);
  }
  sections[section] = value;
}

function loadSection(lang: Language, section: TranslationSection): Promise<void> {
  if (lang === 'en') {
    getEnglishSection(section);
    return Promise.resolve();
  }

  if (getCachedSection(lang, section) !== undefined) {
    return Promise.resolve();
  }

  const key = sectionLoadKey(lang, section);
  const existing = loadingPromises.get(key);
  if (existing) return existing;

  const loader = sectionLoaderIndex.get(key);
  if (!loader) return Promise.resolve();

  const promise = loader()
    .catch(
      () =>
        new Promise<{ default: unknown }>((resolve, reject) => {
          setTimeout(() => {
            loader().then(resolve, reject);
          }, 1000);
        }),
    )
    .then((mod) => {
      cacheSection(lang, section, mod.default);
      mergedSectionCache.delete(`${lang}:${section}`);
      bundleVersion++;
      listeners.forEach((fn) => fn());
    })
    .catch((err: unknown) => {
      import('@/lib/log').then(({ createLogger }) => {
        createLogger('i18n').error(
          `Failed to load "${lang}.${section}" translation section after retry -- falling back to English`,
          { error: err instanceof Error ? err.message : String(err) },
        );
      });
    })
    .finally(() => {
      loadingPromises.delete(key);
    });

  loadingPromises.set(key, promise);
  return promise;
}

/**
 * Kick off loading route-required translation sections. Fires a listener
 * broadcast once each section resolves so useSyncExternalStore re-renders
 * consumers.
 */
export function preloadSections(lang: Language, sections: readonly TranslationSection[]): void {
  for (const section of sections) {
    void loadSection(lang, section);
  }
}

export function preloadLanguage(
  lang: Language,
  sections: readonly TranslationSection[] = ['common'],
): void {
  preloadSections(lang, sections);
}

export function preloadSectionsAsync(
  lang: Language,
  sections: readonly TranslationSection[],
): Promise<void> {
  return Promise.all(sections.map((section) => loadSection(lang, section))).then(() => undefined);
}

export function useLanguagePrefetch(delayMs = 100) {
  const routeSections = useActiveI18nSections();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sections = useMemo(
    () => Array.from(new Set<TranslationSection>(['common', ...routeSections])),
    [routeSections],
  );

  const clearPending = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const prefetchNow = useCallback((lang: Language) => {
    clearPending();
    preloadLanguage(lang, sections);
  }, [clearPending, sections]);

  const prefetchWithIntent = useCallback((lang: Language) => {
    clearPending();
    timeoutRef.current = setTimeout(() => {
      timeoutRef.current = null;
      preloadLanguage(lang, sections);
    }, delayMs);
  }, [clearPending, delayMs, sections]);

  useEffect(() => clearPending, [clearPending]);

  return { prefetchNow, prefetchWithIntent, cancelPrefetch: clearPending };
}

/**
 * Merge a non-English section over its English counterpart. Locale value wins
 * when present; English fills any gap (missing sub-objects, missing leaf keys).
 * Arrays are treated as leaf values (locale array replaces English array
 * wholesale — partial array merging would corrupt index-addressed content).
 *
 * Cached per (lang, section) so the resulting object identity is stable and
 * the merge cost is paid once per section per language.
 */
const mergedSectionCache = new Map<string, unknown>();

function deepMergeSection(base: unknown, override: unknown): unknown {
  if (
    base === null ||
    typeof base !== 'object' ||
    Array.isArray(base) ||
    override === null ||
    typeof override !== 'object' ||
    Array.isArray(override)
  ) {
    return override !== undefined ? override : base;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, val] of Object.entries(override as Record<string, unknown>)) {
    if (val === undefined) continue;
    out[key] = deepMergeSection(out[key], val);
  }
  return out;
}

function getResolvedSection(lang: Language, section: TranslationSection): unknown {
  const english = getEnglishSection(section);
  if (lang === 'en') return english;

  const localized = getCachedSection(lang, section);
  if (localized === undefined) return english;

  const cacheKey = `${lang}:${section}`;
  let merged = mergedSectionCache.get(cacheKey);
  if (merged === undefined) {
    merged = deepMergeSection(english, localized);
    mergedSectionCache.set(cacheKey, merged);
  }
  return merged;
}

function getBundle(lang: Language): Translations {
  if (import.meta.env.DEV && isPseudoActive()) {
    return buildPseudoBundle(getEnglishTranslations());
  }

  if (!bundleCache.has(lang)) {
    const bundle = new Proxy({}, {
      get(_target, prop) {
        if (typeof prop !== 'string' || !isTranslationSection(prop)) {
          return undefined;
        }
        if (lang !== 'en' && getCachedSection(lang, prop) === undefined) {
          preloadSections(lang, [prop]);
        }
        return getResolvedSection(lang, prop);
      },
      has(_target, prop) {
        return typeof prop === 'string' && isTranslationSection(prop);
      },
      ownKeys() {
        return ALL_I18N_SECTIONS;
      },
      getOwnPropertyDescriptor(_target, prop) {
        if (typeof prop === 'string' && isTranslationSection(prop)) {
          return { enumerable: true, configurable: true };
        }
        return undefined;
      },
    }) as Translations;
    bundleCache.set(lang, bundle);
  }
  return bundleCache.get(lang)!;
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
 * Non-hook accessor for the current translation bundle. Use from non-React
 * modules (Zustand store actions, IPC dispatch helpers, event listeners) where
 * `useTranslation` isn't reachable. Reads the active language from i18nStore
 * and returns the cached bundle, falling back to English while a non-English
 * bundle is still being lazy-loaded.
 *
 * Honors the dev-only pseudo-locale toggle so non-React strings show up in
 * the bracketed/accented form too — keeps coverage scans honest.
 */
export function getActiveTranslations(): Translations {
  const { language } = useI18nStore.getState();
  preloadSections(language, ['common']);
  return getBundle(language);
}

/**
 * Primary translation hook. Returns the full translation tree for the
 * active language plus a helper `tx()` for variable interpolation.
 *
 * Non-English locale sections load lazily and temporarily fall back to the
 * matching English section until the chunk resolves. If a locale file is
 * missing keys, the coverage gate in `npm run check:i18n` fails CI.
 *
 * Usage:
 *   const { t, tx, language } = useTranslation();
 *   t.common.save                                // "Save"
 *   tx(t.common.agent_count_other, { count: 5 }) // "5 agents"
 */
export function useTranslation() {
  const { language } = useI18nStore();
  const routeSections = useActiveI18nSections();
  useSyncExternalStore(subscribe, getSnapshot);

  preloadSections(language, routeSections);
  const bundle = getBundle(language);

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
