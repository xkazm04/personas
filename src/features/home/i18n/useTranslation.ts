import { useI18nStore } from '@/stores/i18nStore';
import { en } from './en';
import { zh } from './zh';
import { ar } from './ar';
import { hi } from './hi';
import { ru } from './ru';
import { id } from './id';

const translations = { en, zh, ar, hi, ru, id };

export function useHomeTranslation() {
  const { language } = useI18nStore();

  const t = translations[language].home;

  return { t, language };
}
