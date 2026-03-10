import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Language = 'en' | 'zh' | 'ar' | 'hi' | 'ru' | 'id' | 'es' | 'fr' | 'bn' | 'ja' | 'vi' | 'de' | 'ko' | 'cs';

interface I18nState {
  language: Language;
  setLanguage: (lang: Language) => void;
}

/** Google Fonts URL for languages that need a non-Latin font family. */
const LANG_FONT_URL: Partial<Record<Language, string>> = {
  zh: 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap',
  ar: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap',
  hi: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap',
  bn: 'https://fonts.googleapis.com/css2?family=Noto+Sans+Bengali:wght@400;500;600;700&display=swap',
  ja: 'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&display=swap',
  ko: 'https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap',
};

/** Track which font stylesheets have already been injected. */
const loadedFonts = new Set<string>();

/** Inject a <link> for the language's Google Font if needed (no-op for Latin scripts). */
function loadFontForLanguage(lang: Language) {
  const url = LANG_FONT_URL[lang];
  if (!url || loadedFonts.has(lang)) return;
  loadedFonts.add(lang);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}

/** Apply language attributes to <html> so CSS typography rules activate. */
function applyLangAttributes(lang: Language) {
  const html = document.documentElement;
  html.setAttribute('data-lang', lang);
  html.setAttribute('lang', lang);
  loadFontForLanguage(lang);
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
