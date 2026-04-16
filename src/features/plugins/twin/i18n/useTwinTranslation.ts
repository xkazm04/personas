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

/**
 * The Twin translation contract is the English bundle's shape. Non-English
 * bundles may lag behind on newly-added keys; at runtime missing keys
 * fall back to English (`translations[language]?.twin ?? translations.en.twin`).
 * Casting here keeps consumers from seeing a narrowed union that drops
 * keys absent from any single locale.
 */
type TwinDictionary = typeof en.twin;

export function useTwinTranslation() {
  const { language } = useI18nStore();

  const t = (translations[language]?.twin ?? translations.en.twin) as TwinDictionary;

  return { t, language };
}
