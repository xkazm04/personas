import { create } from 'zustand';
import { persist } from 'zustand/middleware';

<<<<<<< HEAD
export type Language = 'en' | 'zh' | 'ar' | 'hi' | 'ru' | 'id' | 'es' | 'fr' | 'bn' | 'ja' | 'vi' | 'de' | 'ko' | 'cs';
=======
export type Language = 'en' | 'zh' | 'ar' | 'hi' | 'ru' | 'id';
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

interface I18nState {
  language: Language;
  setLanguage: (lang: Language) => void;
}

/** Apply language attributes to <html> so CSS typography rules activate. */
function applyLangAttributes(lang: Language) {
  const html = document.documentElement;
  html.setAttribute('data-lang', lang);
  html.setAttribute('lang', lang);
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      language: 'en',
      setLanguage: (language) => {
        applyLangAttributes(language);
        set({ language });
      },
    }),
    {
      name: 'personas-i18n-storage',
      onRehydrateStorage: () => (state) => {
        if (state) applyLangAttributes(state.language);
      },
    }
  )
);
