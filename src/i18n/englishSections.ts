import type { Translations } from './generated/types';
import { EN_SECTION_STRINGS, type I18nSectionKey } from './generated/enSectionStrings';

export type TranslationSection = I18nSectionKey;

const englishSectionCache = new Map<TranslationSection, unknown>();
let fullEnglishBundle: Translations | null = null;

export const ALL_I18N_SECTIONS = Object.keys(EN_SECTION_STRINGS) as TranslationSection[];

export function isTranslationSection(section: string): section is TranslationSection {
  return Object.prototype.hasOwnProperty.call(EN_SECTION_STRINGS, section);
}

export function getEnglishSection(section: TranslationSection): unknown {
  if (!englishSectionCache.has(section)) {
    englishSectionCache.set(section, JSON.parse(EN_SECTION_STRINGS[section]));
  }
  return englishSectionCache.get(section);
}

export function getEnglishTranslations(): Translations {
  if (!fullEnglishBundle) {
    const bundle: Partial<Record<TranslationSection, unknown>> = {};
    for (const section of ALL_I18N_SECTIONS) {
      bundle[section] = getEnglishSection(section);
    }
    fullEnglishBundle = bundle as unknown as Translations;
  }
  return fullEnglishBundle;
}
