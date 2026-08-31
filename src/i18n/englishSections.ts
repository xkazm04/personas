import type { Translations } from './generated/types';
import { EN_ALL_SECTIONS, EN_CORE_SECTION_STRINGS, type I18nSectionKey } from './generated/enSectionStrings';

export type TranslationSection = I18nSectionKey;

/**
 * The eager English "core" (~13 sections, ~100KB raw — app-shell chrome plus
 * the always-mounted consent/remote-approval/monitor surfaces). This is the
 * ONLY English content statically bundled; every other section is code-split
 * per top-level key and reaches the runtime through
 * `section-locales/en/<section>.json`, discovered by the same glob
 * useTranslation.ts uses for the other 13 locales' sections. See docs at
 * useTranslation.ts's module header.
 */
const CORE_SECTIONS = new Set<TranslationSection>(
  Object.keys(EN_CORE_SECTION_STRINGS) as TranslationSection[],
);

const coreCache = new Map<TranslationSection, unknown>();

/**
 * Non-core English sections, populated once their async chunk resolves.
 * Owned here (not in useTranslation.ts) so `en.ts`'s synchronous shim and the
 * render-path proxy in useTranslation.ts read from a single source of truth.
 * Written exclusively by `setLoadedEnglishSection`, which useTranslation.ts's
 * `loadSection` calls after a chunk import resolves.
 */
const loadedCache = new Map<TranslationSection, unknown>();

export const ALL_I18N_SECTIONS = EN_ALL_SECTIONS as unknown as TranslationSection[];

export function isTranslationSection(section: string): section is TranslationSection {
  return (EN_ALL_SECTIONS as readonly string[]).includes(section);
}

export function isCoreSection(section: TranslationSection): boolean {
  return CORE_SECTIONS.has(section);
}

/**
 * Synchronous English section accessor. Returns the parsed section for a
 * CORE section (always — no async gap, ever) or for any non-core section
 * whose chunk has already resolved via `setLoadedEnglishSection`. Returns
 * `undefined` for a non-core section that hasn't loaded yet.
 *
 * Callers that can tolerate `undefined` (the render-path proxy in
 * useTranslation.ts) must degrade safely rather than throw — see
 * `getResolvedSection`'s fallback there. Callers that need a guaranteed value
 * (module-init consumers via `en.ts`) get it in practice because
 * useTranslation.ts kicks off a background load of every English section the
 * moment it's first imported, which on this app's local, non-network chunk
 * graph resolves long before any deferred (post-boot) `en.section.key` access
 * actually runs — see useTranslation.ts's module header for the full
 * argument and its one disclosed residual risk.
 */
export function getEnglishSection(section: TranslationSection): unknown {
  if (CORE_SECTIONS.has(section)) {
    if (!coreCache.has(section)) {
      coreCache.set(
        section,
        JSON.parse(EN_CORE_SECTION_STRINGS[section as keyof typeof EN_CORE_SECTION_STRINGS]),
      );
    }
    return coreCache.get(section);
  }
  return loadedCache.get(section);
}

/** Record a non-core English section once its chunk resolves. Called only by
 * useTranslation.ts's `loadSection` — this module owns storage/reads, that
 * module owns the fetch/dedupe/re-render-notify machinery. */
export function setLoadedEnglishSection(section: TranslationSection, value: unknown): void {
  loadedCache.set(section, value);
}

export function hasLoadedEnglishSection(section: TranslationSection): boolean {
  return CORE_SECTIONS.has(section) || loadedCache.has(section);
}

/**
 * Best-effort full English bundle: core sections plus whatever non-core
 * sections have already loaded. Used only by the DEV-only pseudo-locale
 * builder (`pseudoLocale.ts`), which re-derives its cached bundle as more
 * sections land (see useTranslation.ts's `getBundle`). NOT a guarantee of
 * completeness — callers that need every section resolved (tests, tooling)
 * should use `getEnglishTranslationsAsync` from useTranslation.ts instead,
 * which awaits every chunk first.
 */
export function getEnglishTranslations(): Translations {
  const bundle: Partial<Record<TranslationSection, unknown>> = {};
  for (const section of ALL_I18N_SECTIONS) {
    bundle[section] = getEnglishSection(section);
  }
  return bundle as unknown as Translations;
}
