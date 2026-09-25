import { useState } from 'react';
import { useI18nStore, type Language } from '@/stores/i18nStore';
import { Check } from 'lucide-react';
import { switchLanguage, useLanguagePrefetch } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

type ScriptFamily = 'latin' | 'cjk' | 'indic' | 'arabic' | 'cyrillic';

type LanguageEntry = {
  code: Language;
  label: string;
  english: string;
  script: ScriptFamily;
};

const LANGUAGES: LanguageEntry[] = [
  { code: 'en', label: 'English', english: 'English', script: 'latin' },
  { code: 'cs', label: 'Čeština', english: 'Czech', script: 'latin' },
  { code: 'de', label: 'Deutsch', english: 'German', script: 'latin' },
  { code: 'es', label: 'Español', english: 'Spanish', script: 'latin' },
  { code: 'fr', label: 'Français', english: 'French', script: 'latin' },
  { code: 'id', label: 'Bahasa Indonesia', english: 'Indonesian', script: 'latin' },
  { code: 'vi', label: 'Tiếng Việt', english: 'Vietnamese', script: 'latin' },
  { code: 'ja', label: '日本語', english: 'Japanese', script: 'cjk' },
  { code: 'ko', label: '한국어', english: 'Korean', script: 'cjk' },
  { code: 'zh', label: '中文', english: 'Chinese', script: 'cjk' },
  { code: 'bn', label: 'বাংলা', english: 'Bengali', script: 'indic' },
  { code: 'hi', label: 'हिन्दी', english: 'Hindi', script: 'indic' },
  { code: 'ar', label: 'العربية', english: 'Arabic', script: 'arabic' },
  { code: 'ru', label: 'Русский', english: 'Russian', script: 'cyrillic' },
];

const SCRIPT_ORDER: ScriptFamily[] = ['latin', 'cjk', 'indic', 'arabic', 'cyrillic'];

function sortLanguages(active: Language): LanguageEntry[] {
  return [...LANGUAGES].sort((a, b) => {
    if (a.code === active) return -1;
    if (b.code === active) return 1;
    const scriptDiff = SCRIPT_ORDER.indexOf(a.script) - SCRIPT_ORDER.indexOf(b.script);
    if (scriptDiff !== 0) return scriptDiff;
    return a.english.localeCompare(b.english);
  });
}

/** Map language code to illustration file (dark variant). */
function langIllustration(code: string) {
  return `/illustrations/languages/lang-${code}.webp`;
}

/** Inline card grid for embedding in Welcome page */
export function LanguageCardGrid() {
  const language = useI18nStore((s) => s.language);
  // The switch is committed only once this route's sections can render in the
  // new locale (see `switchLanguage`), so the pressed card is a real async
  // action: it claims the selected ring, dims, disables the grid and reports
  // `aria-busy` until the chunks land, rather than flipping the whole UI
  // instantly into a half-English state. No spinner - the grid is a tile
  // control, not a Button, and `animate-spin` outside Button/AsyncButton is a
  // hand-rolled spinner by this repo's own census rule.
  const [pending, setPending] = useState<Language | null>(null);
  const { prefetchNow, prefetchWithIntent, cancelPrefetch } = useLanguagePrefetch();
  const sorted = sortLanguages(language);

  const choose = (code: Language) => {
    if (pending) return;
    setPending(code);
    switchLanguage(code)
      .catch(silentCatch('language_switch'))
      .finally(() => setPending(null));
  };
  return (
    <div>
      <div className="animate-fade-slide-in grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2">
        {sorted.map((lang) => {
          const isActive = language === lang.code;
          const isPending = pending === lang.code;
          return (
            <button
              key={lang.code}
              type="button"
              disabled={pending !== null}
              aria-busy={isPending || undefined}
              data-testid={`language-card-${lang.code}`}
              onFocus={() => prefetchWithIntent(lang.code)}
              onBlur={cancelPrefetch}
              onMouseEnter={() => prefetchWithIntent(lang.code)}
              onMouseLeave={cancelPrefetch}
              onPointerDown={() => prefetchNow(lang.code)}
              onClick={() => choose(lang.code)}
              className={`group relative overflow-hidden rounded-modal border transition-all ${
                isActive || isPending ? 'ring-2 ring-primary/60 border-primary/30 shadow-elevation-2' : 'border-primary/10 hover:border-primary/25 hover:ring-1 hover:ring-primary/20'
              } ${isPending ? 'opacity-60' : ''} ${pending && !isPending ? 'opacity-40' : ''}`}
            >
              <div className="relative aspect-[4/3] bg-secondary/30 overflow-hidden">
                <img src={langIllustration(lang.code)} alt="" width={240} height={180} loading="eager" decoding="async"
                  className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 ${isActive ? 'opacity-90 scale-100' : 'opacity-30 scale-105 group-hover:opacity-85 group-hover:scale-100'}`} />
                <div className={`absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent transition-opacity ${isActive ? 'opacity-80' : 'opacity-40 group-hover:opacity-70'}`} />
                {(isActive || isPending) && (
                  <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                    <Check className="w-3 h-3 text-primary-foreground" />
                  </div>
                )}
              </div>
              <div className="px-2 py-1.5 bg-card/80">
                {/* No flag glyph: Windows has no flag emoji and drew each one as its two
                    region letters ("US", "CZ") beside the name; the illustration carries it. */}
                <div className="min-w-0 text-left">
                  <div className="truncate typo-card-label">{lang.label}</div>
                  {lang.code !== 'en' && (
                    <div className="typo-caption truncate">{lang.english}</div>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
