import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useI18nStore, type Language } from '@/stores/i18nStore';
import type { Translations } from './generated/types';
import { buildPseudoBundle, isPseudoActive } from './pseudoLocale';
import {
  ALL_I18N_SECTIONS,
  getEnglishSection,
  getEnglishTranslations,
  isCoreSection,
  isTranslationSection,
  setLoadedEnglishSection,
  type TranslationSection,
} from './englishSections';
import { useActiveI18nSections } from './routeSections';
import { silentCatch } from '@/lib/silentCatch';

export type { Translations };

/**
 * Per-locale/per-section JSON modules, discovered by Vite's import.meta.glob.
 * English is a first-class citizen here now — every top-level section for
 * every one of the 14 locales (English included) is its own async chunk.
 *
 * Only the ~13 "core" English sections (app-shell chrome + the
 * always-mounted consent/remote-approval/monitor surfaces — see
 * englishSections.ts's CORE_SECTIONS) stay eagerly resident, so first paint
 * never has to await a chunk for the sections it actually renders. Every
 * other English section — the ~900KB majority of the catalog — used to be
 * one eagerly-bundled `enSectionStrings.ts` object literal, statically
 * imported by this file (and, independently, by `en.ts`'s ~48 module-init
 * consumers via their eagerly-bundled stores), which is why `en-*.js` used to
 * be the single largest eager chunk in the app. It now reaches the runtime
 * exactly like a non-English locale's section: via this glob.
 *
 * The `import: 'default'` option returns the JSON's default export
 * directly (rather than a module wrapper). `eager: false` keeps each
 * locale/section lazily code-split.
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

/**
 * English's CORE sections are always "cached" (see englishSections.ts);
 * its non-core sections and every other locale's sections funnel through
 * the same per-language Map, populated by `loadSection` below.
 */
function getCachedSection(lang: Language, section: TranslationSection): unknown | undefined {
  if (lang === 'en') {
    return getEnglishSection(section);
  }
  return sectionCache.get(lang)?.[section];
}

function cacheSection(lang: Language, section: TranslationSection, value: unknown): void {
  if (lang === 'en') {
    setLoadedEnglishSection(section, value);
    return;
  }
  let sections = sectionCache.get(lang);
  if (!sections) {
    sections = {};
    sectionCache.set(lang, sections);
  }
  sections[section] = value;
}

function loadSection(lang: Language, section: TranslationSection): Promise<void> {
  // Covers English's core sections (always resolved — see getCachedSection)
  // AND anything already loaded for any language, so this is a true no-op
  // once a section has landed, not just for English.
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
      // eslint-disable-next-line custom/async-catch-requires-helper -- retry combinator, not an error swallow: returns a new Promise that retries the load once, chained further below.
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
    .catch(silentCatch(`i18n:loadSection:${lang}.${section}`))
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

/**
 * Full English bundle, guaranteed complete: awaits every section's chunk
 * (core sections resolve instantly; the rest via `loadSection`) before
 * assembling the result. Async because most English sections are genuinely
 * code-split now — use this from tests/tooling that need every key resolved
 * synchronously-in-effect. Render paths must NOT use this (it would defeat
 * the lazy loading this module exists to provide) — use `useTranslation()`
 * or `getActiveTranslations()` instead, both of which degrade safely while a
 * section is still in flight.
 */
export async function getEnglishTranslationsAsync(): Promise<Translations> {
  await preloadSectionsAsync('en', ALL_I18N_SECTIONS);
  return getEnglishTranslations();
}

// Kick off loading every non-core English section as soon as this module is
// first evaluated — i.e. at app boot, since useTranslation.ts is eagerly
// reachable from the app shell. This is what makes it safe for `en.ts`'s
// ~48 module-init consumers (Zustand slices, modelCatalog, connectorRoles, …)
// to keep reading `en.section.key` synchronously even though most sections
// are no longer eagerly bundled: every one of those consumers touches `en.x`
// from inside a function invoked later (a store action, a render, a
// formatter call), never at pure module-top-level, so by the time any of
// them actually run, this background load — fetching ~44 small local JSON
// chunks, no network involved — has almost always already finished. Fired
// immediately rather than deferred to true browser idle, since correctness
// here depends on winning a race against user interaction, not on being
// polite to a busy main thread.
//
// Residual risk, not closed by this: a pathologically fast synchronous
// `en.section.key` read (via the `en` proxy in en.ts) for a NON-core section,
// occurring before this promise settles, sees `undefined` once rather than
// the real string — it does not throw (englishSections.ts returns
// `undefined`, and property access on that is only unsafe one level up), but
// it also has no re-render to self-heal on, unlike the React render path
// below. No such site was found across en.ts's consumers (see the code
// review that shipped this change), but it isn't statically provable from
// this file alone. Flagged for a live smoke check.
void preloadSectionsAsync(
  'en',
  ALL_I18N_SECTIONS.filter((section) => !isCoreSection(section)),
);

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

// Returned in place of `undefined` when neither English nor the active
// locale has resolved a section yet. Property access on `{}` yields
// `undefined` per key rather than throwing — so a component reading
// `t.someSection.title` before the chunk lands renders blank for that string
// instead of crashing on "Cannot read properties of undefined". This only
// matters for a route visited before its sections finish loading; the
// pre-mount gate in main.tsx and the background preload above make that
// window small, and the listener broadcast in `loadSection` re-renders the
// component with real data the instant the chunk resolves.
const EMPTY_SECTION_FALLBACK: Record<string, never> = Object.freeze({});

function getResolvedSection(lang: Language, section: TranslationSection): unknown {
  const english = getEnglishSection(section);
  if (lang === 'en') return english ?? EMPTY_SECTION_FALLBACK;

  const localized = getCachedSection(lang, section);
  if (localized === undefined) return english ?? EMPTY_SECTION_FALLBACK;
  if (english === undefined) return localized;

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
    // Most English sections are code-split now (see the module header above),
    // so the very first call here — before the background preload below has
    // finished — may see a partial bundle (core sections only). Passing
    // `bundleVersion` busts buildPseudoBundle's cache every time a section
    // finishes loading, so the pseudo view fills in rather than freezing on
    // whatever was resident the first time pseudo mode was toggled.
    return buildPseudoBundle(getEnglishTranslations(), bundleVersion);
  }

  if (!bundleCache.has(lang)) {
    const bundle = new Proxy({}, {
      get(_target, prop) {
        if (typeof prop !== 'string' || !isTranslationSection(prop)) {
          return undefined;
        }
        // Pure read: do NOT trigger preloadSections from a property getter.
        // Sections are preloaded explicitly by useTranslation's effect (for the
        // current route) and useLanguagePrefetch (for hover-intent). Kicking
        // off loaders inside `get` made every distinct top-level section
        // accessed during a render fan out into a fresh preloadSections call
        // + listeners.forEach broadcast, which retriggered more renders and
        // more accesses — a render storm under language switch.
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
  // A missing/renamed translation leaf resolves to `undefined` (or a nested
  // object) at runtime even though the type says `string`. Calling `.replace`
  // on that throws and blanks the whole subtree. Degrade gracefully: return an
  // empty string for nullish, stringify anything else, and warn in dev so the
  // missing key is visible instead of crashing the render.
  if (typeof template !== "string") {
    if (import.meta.env.DEV) {
      console.warn("[i18n] interpolate received a non-string template (missing translation leaf?):", template);
    }
    return template == null ? "" : String(template);
  }
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`,
  );
}

/**
 * Non-hook accessor for the current translation bundle. Use from non-React
 * modules (Zustand store actions, IPC dispatch helpers, event listeners) where
 * `useTranslation` isn't reachable. Reads the active language from i18nStore
 * and returns the cached bundle. A section that hasn't finished loading yet
 * (English or otherwise — see the module header) resolves to an empty object
 * rather than crashing; see `getResolvedSection`'s `EMPTY_SECTION_FALLBACK`.
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
 * All 14 locales — English included — load their sections lazily, one async
 * chunk per top-level key (see the module header). A section that hasn't
 * finished loading yet resolves to English if English is ready, or to an
 * empty object otherwise, until the chunk resolves — never a raw key, never a
 * crash. Non-English locales additionally deep-merge over their English
 * counterpart once both are loaded, so a translation lag never renders
 * `undefined`. If a locale file is missing keys, the coverage gate in
 * `npm run check:i18n` fails CI.
 *
 * Usage:
 *   const { t, tx, language } = useTranslation();
 *   t.common.save                                // "Save"
 *   tx(t.common.agent_count_other, { count: 5 }) // "5 agents"
 */
export function useTranslation() {
  // Selective subscription: only re-render this hook's consumers on actual
  // language changes. The whole-store destructure used to fan out fontReady
  // flips (set by font-loader onload) to every translated component, doubling
  // the rerender cost of any language switch involving CJK/Arabic/Devanagari.
  const language = useI18nStore((s) => s.language);
  const routeSections = useActiveI18nSections();
  useSyncExternalStore(subscribe, getSnapshot);

  // Preload outside render: kicking off async loaders during render allocated
  // promises and broadcast listeners on every render of every translated
  // component. With sectionsForRoute now memoized, the dep array is stable.
  useEffect(() => {
    preloadSections(language, routeSections);
  }, [language, routeSections]);

  const bundle = getBundle(language);

  // Stable return identity per language so consumers that destructure
  // `const { t } = useTranslation()` and pass `t` into useMemo deps, React.memo,
  // or context providers don't get spurious invalidations every parent render.
  return useMemo(
    () => ({
      /** Full translation tree for the active language. */
      t: bundle,
      /** Active language code (e.g. "en", "zh", "es"). */
      language,
      /**
       * Interpolate variables into a translation string.
       * @example tx(t.common.agent_count_other, { count: 5 })
       */
      tx: interpolate,
    }),
    [bundle, language],
  );
}
