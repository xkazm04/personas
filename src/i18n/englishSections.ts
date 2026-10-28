import type { Translations } from './generated/types';
import {
  EN_ALL_SECTIONS,
  EN_CORE_SECTION_STRINGS,
  EN_PARTIAL_SECTION_STRINGS,
  type I18nSectionKey,
} from './generated/enSectionStrings';

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
  return loadedCache.get(section) ?? getPartialSection(section);
}

/**
 * Partial core (FIRST_PAINT_PARTIAL_SECTIONS in routeSections.ts, 2026-10-25):
 * for a section the always-mounted chrome reads only a few keys of, the build
 * carries just those keys eagerly, and `getEnglishSection` serves them until
 * the full section's chunk lands. A read of a key outside the partial returns
 * undefined for that window - useTranslation.ts reads a partial over the
 * section's shape (no throw at any depth) and re-renders when the full one
 * arrives.
 */
function getPartialSection(section: TranslationSection): unknown {
  const raw = EN_PARTIAL_SECTION_STRINGS[section];
  if (raw === undefined) return undefined;
  // The same parse memo as the core: both hold eager JSON strings, and a
  // partial section is never a core one (split-locales.mjs refuses that).
  if (!coreCache.has(section)) coreCache.set(section, JSON.parse(raw));
  return coreCache.get(section);
}

/** The whole section is resident: core, or its chunk has landed. A partial is not. */
export function hasFullEnglishSection(section: TranslationSection): boolean {
  return CORE_SECTIONS.has(section) || loadedCache.has(section);
}

/** Only the partial core is resident for this section (its full chunk has not landed). */
export function isPartialEnglishSection(section: TranslationSection): boolean {
  return !hasFullEnglishSection(section) && EN_PARTIAL_SECTION_STRINGS[section] !== undefined;
}

/** Record a non-core English section once its chunk resolves. Called only by
 * useTranslation.ts's `loadSection` — this module owns storage/reads, that
 * module owns the fetch/dedupe/re-render-notify machinery. */
export function setLoadedEnglishSection(section: TranslationSection, value: unknown): void {
  loadedCache.set(section, value);
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
