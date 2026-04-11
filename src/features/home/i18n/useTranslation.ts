/**
 * Home-feature translation hook (lazy-loading).
 *
 * @deprecated This feature-scoped hook will be consolidated into the main
 * `useTranslation()` hook in a future i18n migration. The `home` section
 * already exists in the main `src/i18n/en.ts` — the feature-scoped locale
 * files in this directory should be merged into the main locale files.
 * See: i18n Phase 2 consolidation plan.
 */
import { useI18nStore, type Language } from '@/stores/i18nStore';
import { en } from './en';

type HomeTranslations = typeof en.home;

const loaders: Record<Language, () => Promise<{ home: HomeTranslations }>> = {
  en: () => import('./en').then(m => m.en as { home: HomeTranslations }),
  zh: () => import('./zh').then(m => m.zh as unknown as { home: HomeTranslations }),
  ar: () => import('./ar').then(m => m.ar as unknown as { home: HomeTranslations }),
  hi: () => import('./hi').then(m => m.hi as unknown as { home: HomeTranslations }),
  ru: () => import('./ru').then(m => m.ru as unknown as { home: HomeTranslations }),
  id: () => import('./id').then(m => m.id as unknown as { home: HomeTranslations }),
  es: () => import('./es').then(m => m.es as unknown as { home: HomeTranslations }),
  fr: () => import('./fr').then(m => m.fr as unknown as { home: HomeTranslations }),
  bn: () => import('./bn').then(m => m.bn as unknown as { home: HomeTranslations }),
  ja: () => import('./ja').then(m => m.ja as unknown as { home: HomeTranslations }),
  vi: () => import('./vi').then(m => m.vi as unknown as { home: HomeTranslations }),
  de: () => import('./de').then(m => m.de as unknown as { home: HomeTranslations }),
  ko: () => import('./ko').then(m => m.ko as unknown as { home: HomeTranslations }),
  cs: () => import('./cs').then(m => m.cs as unknown as { home: HomeTranslations }),
};

const cache = new Map<Language, HomeTranslations>();
cache.set('en', en.home);

const listeners = new Set<() => void>();

function preload(lang: Language) {
  if (cache.has(lang)) return;
  loaders[lang]().then(bundle => {
    cache.set(lang, { ...en.home, ...bundle.home });
    listeners.forEach(fn => fn());
  });
}

export function useHomeTranslation() {
  const { language } = useI18nStore();

  if (!cache.has(language)) {
    preload(language);
  }

  const t = cache.get(language) ?? en.home;
  return { t, language };
}
