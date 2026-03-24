import { useState, useCallback } from 'react';
import { Languages, Download, Upload, ExternalLink, Check, AlertCircle } from 'lucide-react';
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

/** Launch languages with full translation coverage. */
const LAUNCH_LANGUAGES = new Set<Language>(['en', 'zh', 'es']);

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

export default function TranslationContributor() {
  const { language } = useI18nStore();
  useTranslation(); // subscribe to language changes
  const [importStatus, setImportStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleExportKeys = useCallback(() => {
    const flat = flatten(en as unknown as Record<string, unknown>);
    const blob = new Blob([JSON.stringify(flat, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `personas-i18n-keys-en.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleImportTranslation = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        JSON.parse(text); // Validate it's valid JSON
        // Save to localStorage for community contributions
        const key = `personas-community-i18n-${file.name.replace('.json', '')}`;
        localStorage.setItem(key, text);
        setImportStatus('success');
        setTimeout(() => setImportStatus('idle'), 3000);
      } catch {
        setImportStatus('error');
        setTimeout(() => setImportStatus('idle'), 3000);
      }
    };
    input.click();
  }, []);

  const currentLang = ALL_LANGUAGES.find(l => l.code === language);

  return (
    <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
      <SectionHeading title="Language & Translations" icon={<Languages />} />

      {/* Current language display */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary/30 border border-primary/10">
        <span className="text-lg">{currentLang?.flag}</span>
        <div>
          <p className="typo-heading text-foreground/90">{currentLang?.label}</p>
          <p className="typo-caption text-muted-foreground/60">
            {LAUNCH_LANGUAGES.has(language)
              ? interpolate('{count} translation keys', { count: TOTAL_KEYS })
              : 'Community translation'
            }
          </p>
        </div>
        {LAUNCH_LANGUAGES.has(language) && (
          <span className="ml-auto px-2 py-0.5 typo-label rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
            Full
          </span>
        )}
      </div>

      {/* Language coverage grid */}
      <div>
        <p className="typo-caption text-muted-foreground/60 mb-2">Translation coverage</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {ALL_LANGUAGES.map((lang) => {
            const isLaunch = LAUNCH_LANGUAGES.has(lang.code);
            const isActive = language === lang.code;
            return (
              <div
                key={lang.code}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                  isActive
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-primary/8 bg-secondary/20'
                }`}
              >
                <span className="text-sm">{lang.flag}</span>
                <span className={`typo-caption truncate ${isActive ? 'text-foreground' : 'text-muted-foreground/70'}`}>
                  {lang.label}
                </span>
                {isLaunch ? (
                  <Check className="w-3 h-3 text-emerald-400 ml-auto shrink-0" />
                ) : (
                  <span className="ml-auto typo-label text-muted-foreground/40">--</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Contribution actions */}
      <div className="border-t border-primary/10 pt-4 space-y-3">
        <p className="typo-heading text-foreground/80">Contribute translations</p>
        <p className="typo-caption text-muted-foreground/60">
          Help translate Personas into your language. Export the English keys, translate them, and submit via GitHub or import directly.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="md"
            icon={<Download className="w-3.5 h-3.5" />}
            onClick={handleExportKeys}
          >
            Export English keys
          </Button>

          <Button
            variant="secondary"
            size="md"
            icon={<Upload className="w-3.5 h-3.5" />}
            onClick={handleImportTranslation}
          >
            Import translation
          </Button>

          <Button
            variant="ghost"
            size="md"
            icon={<ExternalLink className="w-3.5 h-3.5" />}
            onClick={() => window.open('https://github.com/anthropics/personas-desktop/tree/main/src/i18n', '_blank')}
          >
            Contribute on GitHub
          </Button>
        </div>

        {importStatus === 'success' && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span className="typo-caption text-emerald-400">Translation file imported successfully</span>
          </div>
        )}
        {importStatus === 'error' && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-3.5 h-3.5 text-red-400" />
            <span className="typo-caption text-red-400">Invalid JSON file. Please check the format and try again.</span>
          </div>
        )}
      </div>
    </div>
  );
}
