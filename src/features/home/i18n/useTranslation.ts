import { useI18nStore } from '@/stores/i18nStore';
import { en } from './en';
import { zh } from './zh';
import { ar } from './ar';
import { hi } from './hi';
import { ru } from './ru';
import { id } from './id';
<<<<<<< HEAD
import { es } from './es';
import { fr } from './fr';
import { bn } from './bn';
import { ja } from './ja';
import { vi } from './vi';
import { de } from './de';
import { ko } from './ko';
import { cs } from './cs';

const translations = { en, zh, ar, hi, ru, id, es, fr, bn, ja, vi, de, ko, cs };
=======

const translations = { en, zh, ar, hi, ru, id };
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

export function useHomeTranslation() {
  const { language } = useI18nStore();

  const t = translations[language].home;

  return { t, language };
}
