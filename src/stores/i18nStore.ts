import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { LocaleCode } from '@/i18n/locales.manifest';

/**
 * Supported UI languages. Driven by the LOCALES manifest —
 * to add/remove a language, edit `src/i18n/locales.manifest.ts`.
 */
export type Language = LocaleCode;

interface I18nState {
  language: Language;
  fontReady: boolean;
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

/** Inject a <link> for the language's Google Font asynchronously. */
function loadFontForLanguage(lang: Language) {
  const url = LANG_FONT_URL[lang];
  if (!url || loadedFonts.has(lang)) return;
  loadedFonts.add(lang);

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  // Load asynchronously: start as print media, swap to all on load
  link.media = 'print';
  link.onload = () => {
    link.media = 'all';
    useI18nStore.setState({ fontReady: true });
  };
  link.onerror = () => {
    // Still mark ready so UI doesn't hang waiting for a failed font
    link.media = 'all';
    useI18nStore.setState({ fontReady: true });
  };
  document.head.appendChild(link);
}

/** Apply language attributes to <html> so CSS typography rules activate. */
function applyLangAttributes(lang: Language) {
  const html = document.documentElement;
  html.setAttribute('data-lang', lang);
  html.setAttribute('lang', lang);

  // If switching to a language that needs a custom font, mark not ready until loaded
  const needsFont = lang in LANG_FONT_URL && !loadedFonts.has(lang);
  if (needsFont) {
    useI18nStore.setState({ fontReady: false });
  }

  loadFontForLanguage(lang);
}

export const useI18nStore = create<I18nState>()(
  persist(
    (set) => ({
      language: 'en',
      fontReady: true,
      setLanguage: (language) => {
        applyLangAttributes(language);
        set({ language });
      },
    }),
    {
      name: 'personas-i18n-storage',
      partialize: (state) => ({ language: state.language }),
      onRehydrateStorage: () => (state) => {
        if (state) applyLangAttributes(state.language);
      },
    }
  )
);
