import { useState, useEffect, useCallback } from 'react';
import { Languages, Download, ExternalLink, Check } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { Button } from '@/features/shared/components/buttons';
import { useI18nStore, type Language } from '@/stores/i18nStore';
import { useTranslation, interpolate } from '@/i18n/useTranslation';
import { en } from '@/i18n/en';

/** All supported languages with their native labels. */
const ALL_LANGUAGES: { code: Language; label: string; flag: string }[] = [
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
  { code: 'es', label: 'Espanol', flag: '🇪🇸' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
  { code: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
  { code: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'fr', label: 'Francais', flag: '🇫🇷' },
  { code: 'bn', label: 'বাংলা', flag: '🇧🇩' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'vi', label: 'Tieng Viet', flag: '🇻🇳' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'cs', label: 'Cestina', flag: '🇨🇿' },
];

/** Count total leaf keys in a nested translation object. */
function countKeys(obj: Record<string, unknown>): number {
  let count = 0;
  for (const val of Object.values(obj)) {
    if (typeof val === 'object' && val !== null) {
      count += countKeys(val as Record<string, unknown>);
    } else {
      count++;
    }
  }
  return count;
}

const TOTAL_KEYS = countKeys(en as unknown as Record<string, unknown>);

/**
 * Flatten a nested object into dot-path keys for export.
 * e.g. { common: { save: "Save" } } -> { "common.save": "Save" }
 */
function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'object' && val !== null) {
      Object.assign(result, flatten(val as Record<string, unknown>, path));
    } else {
      result[path] = String(val);
    }
  }
  return result;
}

/** Dynamic import loaders for each language file — mirrors useTranslation loaders. */
const langLoaders: Record<Language, () => Promise<Record<string, unknown>>> = {
  en: () => import('@/i18n/en').then(m => m.en as unknown as Record<string, unknown>),
  zh: () => import('@/i18n/zh').then(m => m.zh as unknown as Record<string, unknown>),
  es: () => import('@/i18n/es').then(m => m.es as unknown as Record<string, unknown>),
  ar: () => import('@/i18n/ar').then(m => m.ar as unknown as Record<string, unknown>),
  hi: () => import('@/i18n/hi').then(m => m.hi as unknown as Record<string, unknown>),
  ru: () => import('@/i18n/ru').then(m => m.ru as unknown as Record<string, unknown>),
  id: () => import('@/i18n/id').then(m => m.id as unknown as Record<string, unknown>),
  fr: () => import('@/i18n/fr').then(m => m.fr as unknown as Record<string, unknown>),
  bn: () => import('@/i18n/bn').then(m => m.bn as unknown as Record<string, unknown>),
  ja: () => import('@/i18n/ja').then(m => m.ja as unknown as Record<string, unknown>),
  vi: () => import('@/i18n/vi').then(m => m.vi as unknown as Record<string, unknown>),
  de: () => import('@/i18n/de').then(m => m.de as unknown as Record<string, unknown>),
  ko: () => import('@/i18n/ko').then(m => m.ko as unknown as Record<string, unknown>),
  cs: () => import('@/i18n/cs').then(m => m.cs as unknown as Record<string, unknown>),
};

export default function TranslationContributor() {
  const { language } = useI18nStore();
  const { t } = useTranslation(); // subscribe to language changes
  const s = t.settings.appearance;
  const [coverage, setCoverage] = useState<Record<Language, number>>({} as Record<Language, number>);
  const [exporting, setExporting] = useState<Language | null>(null);

  // Load all language files and compute real coverage on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results: Record<string, number> = {};
      for (const lang of ALL_LANGUAGES) {
        try {
          const bundle = await langLoaders[lang.code]();
          const keys = countKeys(bundle);
          if (!cancelled) results[lang.code] = keys;
        } catch {
          if (!cancelled) results[lang.code] = 0;
        }
      }
      if (!cancelled) setCoverage(results as Record<Language, number>);
    })();
    return () => { cancelled = true; };
  }, []);

  const handleExport = useCallback(async (code: Language) => {
    setExporting(code);
    try {
      const bundle = await langLoaders[code]();
      const flat = flatten(bundle);
      const blob = new Blob([JSON.stringify(flat, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `personas-i18n-${code}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(null);
    }
  }, []);

  const currentLang = ALL_LANGUAGES.find(l => l.code === language);
  const currentCoverage = coverage[language] ?? 0;
  const currentPct = TOTAL_KEYS > 0 ? Math.round((currentCoverage / TOTAL_KEYS) * 100) : 0;

  return (
    <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
      <SectionHeading title={s.language_translations} icon={<Languages />} />

      {/* Current language display */}
      <div className="flex items-center gap-3 p-3 rounded-card bg-secondary/30 border border-primary/10">
        <span className="text-lg">{currentLang?.flag}</span>
        <div>
          <p className="typo-heading text-foreground/90">{currentLang?.label}</p>
          <p className="typo-caption text-muted-foreground/60">
            {currentPct === 100
              ? interpolate(s.translation_keys, { count: TOTAL_KEYS })
              : interpolate(s.translation_coverage, { covered: currentCoverage, total: TOTAL_KEYS, pct: currentPct })
            }
          </p>
        </div>
        {currentPct === 100 && (
          <span className="ml-auto px-2 py-0.5 typo-label rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
            {s.coverage_full}
          </span>
        )}
      </div>

      {/* Language coverage grid — click a language to export its file */}
      <div>
        <p className="typo-caption text-muted-foreground/60 mb-2">{s.coverage_hint}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {ALL_LANGUAGES.map((lang) => {
            const keys = coverage[lang.code] ?? 0;
            const pct = TOTAL_KEYS > 0 ? Math.round((keys / TOTAL_KEYS) * 100) : 0;
            const isFull = pct === 100;
            const isActive = language === lang.code;
            const isExportingThis = exporting === lang.code;

            return (
              <button
                key={lang.code}
                type="button"
                onClick={() => handleExport(lang.code)}
                disabled={isExportingThis}
                className={`flex items-center gap-2 px-3 py-2 rounded-card border transition-colors text-left group ${
                  isActive
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-primary/8 bg-secondary/20 hover:bg-secondary/40 hover:border-primary/15'
                }`}
              >
                <span className="text-sm">{lang.flag}</span>
                <div className="flex-1 min-w-0">
                  <span className={`typo-caption truncate block ${isActive ? 'text-foreground' : 'text-muted-foreground/70'}`}>
                    {lang.label}
                  </span>
                  {/* Coverage bar */}
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className="flex-1 h-1 rounded-full bg-foreground/[0.06] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${isFull ? 'bg-emerald-400' : pct > 50 ? 'bg-amber-400/70' : 'bg-foreground/20'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="typo-label text-muted-foreground/50 tabular-nums w-7 text-right">{pct}%</span>
                  </div>
                </div>
                {isFull ? (
                  <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                ) : (
                  <Download className="w-3 h-3 text-muted-foreground/30 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Contribution link */}
      <div className="border-t border-primary/10 pt-4 space-y-3">
        <p className="typo-heading text-foreground/80">{s.contribute_title}</p>
        <p className="typo-caption text-muted-foreground/60">
          {s.contribute_hint}
        </p>
        <Button
          variant="ghost"
          size="md"
          icon={<ExternalLink className="w-3.5 h-3.5" />}
          onClick={() => window.open('https://github.com/anthropics/personas-desktop/tree/main/src/i18n', '_blank')}
        >
          {s.contribute_github}
        </Button>
      </div>
    </div>
  );
}
