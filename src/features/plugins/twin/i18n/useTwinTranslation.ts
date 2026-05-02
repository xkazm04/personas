import { useMemo } from 'react';
import { useI18nStore } from '@/stores/i18nStore';
import { en } from './en';
import { zh } from './zh';
import { ar } from './ar';
import { hi } from './hi';
import { ru } from './ru';
import { id } from './id';
import { es } from './es';
import { fr } from './fr';
import { bn } from './bn';
import { ja } from './ja';
import { vi } from './vi';
import { de } from './de';
import { ko } from './ko';
import { cs } from './cs';

const translations = { en, zh, ar, hi, ru, id, es, fr, bn, ja, vi, de, ko, cs };

// Unlike the root i18n bundle (which is CI-enforced at 100% coverage), the
// feature-scoped twin locales have no coverage gate — non-English files
// regularly lag the English source on newly-added keys. Falling back at the
// whole-namespace level would render `undefined` (visible as empty strings)
// for any missing leaf key. Deep-merge guarantees every key resolves, with
// the locale's value winning when present and the English value filling gaps.
function deepMerge<T>(base: T, override: unknown): T {
  if (typeof base !== 'object' || base === null) return base;
  if (typeof override !== 'object' || override === null) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(override as Record<string, unknown>)) {
    const baseVal = (base as Record<string, unknown>)[key];
    const overrideVal = (override as Record<string, unknown>)[key];
    if (
      typeof baseVal === 'object' && baseVal !== null && !Array.isArray(baseVal) &&
      typeof overrideVal === 'object' && overrideVal !== null && !Array.isArray(overrideVal)
    ) {
      out[key] = deepMerge(baseVal, overrideVal);
    } else if (overrideVal !== undefined) {
      out[key] = overrideVal;
    }
  }
  return out as T;
}

export function useTwinTranslation() {
  const { language } = useI18nStore();

  const t = useMemo(() => {
    const localeBundle = translations[language]?.twin;
    if (!localeBundle || language === 'en') return translations.en.twin;
    return deepMerge(translations.en.twin, localeBundle);
  }, [language]);

  return { t, language };
}
