/**
 * Translation hook for the "What's New" feature (lazy-loading).
 *
 * @deprecated This feature-scoped hook will be consolidated into the main
 * `useTranslation()` hook in a future i18n migration. The release-specific
 * locale files in this directory should be merged into the main locale files.
 * See: i18n Phase 2 consolidation plan.
 *
 * Adding a new release item via `/research` Phase 12? You MUST add the
 * `title` + `description` keys to ALL 14 locale files in this folder. The
 * non-English files start as English placeholders with `// TODO(i18n-XX)`
 * markers — keep that pattern when extending.
 */
import { useI18nStore, type Language } from '@/stores/i18nStore';
import { en } from './en';

type WhatsNewTranslations = typeof en.whatsNew;

const loaders: Record<Language, () => Promise<{ whatsNew: WhatsNewTranslations }>> = {
  en: () => import('./en').then(m => m.en as { whatsNew: WhatsNewTranslations }),
  zh: () => import('./zh').then(m => m.zh as unknown as { whatsNew: WhatsNewTranslations }),
  ar: () => import('./ar').then(m => m.ar as unknown as { whatsNew: WhatsNewTranslations }),
  hi: () => import('./hi').then(m => m.hi as unknown as { whatsNew: WhatsNewTranslations }),
  ru: () => import('./ru').then(m => m.ru as unknown as { whatsNew: WhatsNewTranslations }),
  id: () => import('./id').then(m => m.id as unknown as { whatsNew: WhatsNewTranslations }),
  es: () => import('./es').then(m => m.es as unknown as { whatsNew: WhatsNewTranslations }),
  fr: () => import('./fr').then(m => m.fr as unknown as { whatsNew: WhatsNewTranslations }),
  bn: () => import('./bn').then(m => m.bn as unknown as { whatsNew: WhatsNewTranslations }),
  ja: () => import('./ja').then(m => m.ja as unknown as { whatsNew: WhatsNewTranslations }),
  vi: () => import('./vi').then(m => m.vi as unknown as { whatsNew: WhatsNewTranslations }),
  de: () => import('./de').then(m => m.de as unknown as { whatsNew: WhatsNewTranslations }),
  ko: () => import('./ko').then(m => m.ko as unknown as { whatsNew: WhatsNewTranslations }),
  cs: () => import('./cs').then(m => m.cs as unknown as { whatsNew: WhatsNewTranslations }),
};

const cache = new Map<Language, WhatsNewTranslations>();
cache.set('en', en.whatsNew);

const listeners = new Set<() => void>();

function preload(lang: Language) {
  if (cache.has(lang)) return;
  loaders[lang]().then(bundle => {
    cache.set(lang, { ...en.whatsNew, ...bundle.whatsNew });
    listeners.forEach(fn => fn());
  });
}

export function useReleasesTranslation() {
  const { language } = useI18nStore();

  if (!cache.has(language)) {
    preload(language);
  }

  const t = cache.get(language) ?? en.whatsNew;
  return { t, language };
}

/** Type of the namespaced translation object — useful for prop typing. */
export type ReleasesTranslation = typeof en.whatsNew;
