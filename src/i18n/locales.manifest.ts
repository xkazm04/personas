/**
 * Single source of truth for the set of locales the app knows. Which of them
 * it SHIPS is `SHIPPED_UI_LOCALES` below (English only since 2026-10-25).
 *
 * To ADD a language:
 *   1. Copy `src/i18n/locales/en.json` to `src/i18n/locales/<code>.json`.
 *   2. Translate the values (keys stay the same).
 *   3. Add an entry to `LOCALES` below.
 *   4. `npm run check:i18n` must pass — every locale's keyset must match en.
 *
 * To REMOVE a language:
 *   1. Delete `src/i18n/locales/<code>.json`.
 *   2. Delete the entry in `LOCALES` below.
 *   3. Done — no other file references a locale by code.
 */

export interface LocaleDescriptor {
  /** BCP 47 language subtag used as filename stem and store key. */
  code: string;
  /** Native self-name, shown in the language picker. */
  nativeName: string;
  /** English name, used for admin/debug UIs. */
  englishName: string;
  /** Writing direction; RTL locales swap layout mirroring. */
  dir: 'ltr' | 'rtl';
}

/**
 * Note: no `: readonly LocaleDescriptor[]` annotation — that would widen away
 * the `as const` literal types for `code`, which `LocaleCode` below derives.
 * The array still conforms to `readonly LocaleDescriptor[]` structurally.
 */
export const LOCALES = [
  { code: 'en', nativeName: 'English',    englishName: 'English',              dir: 'ltr' },
  { code: 'ar', nativeName: 'العربية',    englishName: 'Arabic',               dir: 'rtl' },
  { code: 'bn', nativeName: 'বাংলা',      englishName: 'Bengali',              dir: 'ltr' },
  { code: 'cs', nativeName: 'Čeština',    englishName: 'Czech',                dir: 'ltr' },
  { code: 'de', nativeName: 'Deutsch',    englishName: 'German',               dir: 'ltr' },
  { code: 'es', nativeName: 'Español',    englishName: 'Spanish',              dir: 'ltr' },
  { code: 'fr', nativeName: 'Français',   englishName: 'French',               dir: 'ltr' },
  { code: 'hi', nativeName: 'हिन्दी',      englishName: 'Hindi',                dir: 'ltr' },
  { code: 'id', nativeName: 'Indonesia',  englishName: 'Indonesian',           dir: 'ltr' },
  { code: 'ja', nativeName: '日本語',      englishName: 'Japanese',             dir: 'ltr' },
  { code: 'ko', nativeName: '한국어',      englishName: 'Korean',               dir: 'ltr' },
  { code: 'ru', nativeName: 'Русский',    englishName: 'Russian',              dir: 'ltr' },
  { code: 'vi', nativeName: 'Tiếng Việt', englishName: 'Vietnamese',           dir: 'ltr' },
  { code: 'zh', nativeName: '中文',        englishName: 'Chinese (Simplified)', dir: 'ltr' },
] as const;

export type LocaleCode = (typeof LOCALES)[number]['code'];

export const LOCALE_CODES = LOCALES.map((l) => l.code) as readonly LocaleCode[];

/**
 * The UI languages the app actually SHIPS — a subset of `LOCALES`.
 *
 * Operator decision 2026-10-25: the app is English-only until its core is
 * done. The 13 other locale files stay in `src/i18n/locales/` and keep being
 * split into `section-locales/`, but nothing outside this list is bundled,
 * selectable, or checked by CI or hooks (`check:i18n`, the lefthook i18n
 * gates and the translate pipeline are all off).
 *
 * To revive a language: add its code here and re-run
 * `node scripts/run-codegen.mjs prebuild`. `scripts/i18n/split-locales.mjs`
 * reads this array by regex and emits the lazy loaders for exactly these
 * locales into `generated/sectionLoaders.ts`; the language pickers reappear
 * once the list has more than one entry. Re-enable the coverage gates in
 * `lefthook.yml` and `ci.yml` in the same change.
 */
export const SHIPPED_UI_LOCALES: readonly LocaleCode[] = ['en'];

/** A persisted or requested language the build does not ship falls back to English. */
export function toShippedUiLocale(code: string): LocaleCode {
  return SHIPPED_UI_LOCALES.includes(code as LocaleCode) ? (code as LocaleCode) : 'en';
}

/** The language pickers (welcome, settings, onboarding) render only when there is a choice. */
export const UI_LANGUAGE_PICKER_ENABLED = SHIPPED_UI_LOCALES.length > 1;

export function getLocaleDescriptor(code: string): LocaleDescriptor | undefined {
  return LOCALES.find((l) => l.code === code);
}

export function isLocaleCode(code: string): code is LocaleCode {
  return LOCALE_CODES.includes(code as LocaleCode);
}
