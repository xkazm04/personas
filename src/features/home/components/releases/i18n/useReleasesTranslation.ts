/**
 * Translation hook for the "What's New" feature.
 *
 * Mirrors the project pattern: import every locale file, pick by current
 * language, return `{ t, language }` where `t` is the namespaced object.
 *
 * Adding a new release item via `/research` Phase 12? You MUST add the
 * `title` + `description` keys to ALL 14 locale files in this folder. The
 * non-English files start as English placeholders with `// TODO(i18n-XX)`
 * markers — keep that pattern when extending.
 */
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

export function useReleasesTranslation() {
  const { language } = useI18nStore();
  const t = translations[language].whatsNew;
  return { t, language };
}

/** Type of the namespaced translation object — useful for prop typing. */
export type ReleasesTranslation = typeof en.whatsNew;
