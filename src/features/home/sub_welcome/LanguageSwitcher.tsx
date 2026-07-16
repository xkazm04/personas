import { useI18nStore, type Language } from '@/stores/i18nStore';
import { Check } from 'lucide-react';
import { useLanguagePrefetch } from '@/i18n/useTranslation';

type ScriptFamily = 'latin' | 'cjk' | 'indic' | 'arabic' | 'cyrillic';

type LanguageEntry = {
  code: Language;
  label: string;
  english: string;
  flag: string;
  script: ScriptFamily;
};

const LANGUAGES: LanguageEntry[] = [
  { code: 'en', label: 'English', english: 'English', flag: '🇺🇸', script: 'latin' },
  { code: 'cs', label: 'Čeština', english: 'Czech', flag: '🇨🇿', script: 'latin' },
  { code: 'de', label: 'Deutsch', english: 'German', flag: '🇩🇪', script: 'latin' },
  { code: 'es', label: 'Español', english: 'Spanish', flag: '🇪🇸', script: 'latin' },
  { code: 'fr', label: 'Français', english: 'French', flag: '🇫🇷', script: 'latin' },
  { code: 'id', label: 'Bahasa Indonesia', english: 'Indonesian', flag: '🇮🇩', script: 'latin' },
  { code: 'vi', label: 'Tiếng Việt', english: 'Vietnamese', flag: '🇻🇳', script: 'latin' },
  { code: 'ja', label: '日本語', english: 'Japanese', flag: '🇯🇵', script: 'cjk' },
  { code: 'ko', label: '한국어', english: 'Korean', flag: '🇰🇷', script: 'cjk' },
  { code: 'zh', label: '中文', english: 'Chinese', flag: '🇨🇳', script: 'cjk' },
  { code: 'bn', label: 'বাংলা', english: 'Bengali', flag: '🇧🇩', script: 'indic' },
  { code: 'hi', label: 'हिन्दी', english: 'Hindi', flag: '🇮🇳', script: 'indic' },
  { code: 'ar', label: 'العربية', english: 'Arabic', flag: '🇸🇦', script: 'arabic' },
  { code: 'ru', label: 'Русский', english: 'Russian', flag: '🇷🇺', script: 'cyrillic' },
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
  return `/illustrations/languages/lang-${code}.png`;
}

/** Inline card grid for embedding in Welcome page */
export function LanguageCardGrid() {
  const language = useI18nStore((s) => s.language);
  const setLanguage = useI18nStore((s) => s.setLanguage);
  const { prefetchNow, prefetchWithIntent, cancelPrefetch } = useLanguagePrefetch();
  const sorted = sortLanguages(language);
  return (
    <div>
      <div className="animate-fade-slide-in grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-2">
        {sorted.map((lang) => {
          const isActive = language === lang.code;
          return (
            <button
              key={lang.code}
              type="button"
              onFocus={() => prefetchWithIntent(lang.code)}
              onBlur={cancelPrefetch}
              onMouseEnter={() => prefetchWithIntent(lang.code)}
              onMouseLeave={cancelPrefetch}
              onPointerDown={() => prefetchNow(lang.code)}
              onClick={() => setLanguage(lang.code)}
              className={`group relative overflow-hidden rounded-modal border transition-all ${
                isActive ? 'ring-2 ring-primary/60 border-primary/30 shadow-elevation-2' : 'border-primary/10 hover:border-primary/25 hover:ring-1 hover:ring-primary/20'
              }`}
            >
              <div className="relative aspect-[4/3] bg-secondary/30 overflow-hidden">
                <img src={langIllustration(lang.code)} alt="" width={240} height={180} loading="eager" decoding="async"
                  className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 ${isActive ? 'opacity-90 scale-100' : 'opacity-30 scale-105 group-hover:opacity-85 group-hover:scale-100'}`} />
                <div className={`absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent transition-opacity ${isActive ? 'opacity-80' : 'opacity-40 group-hover:opacity-70'}`} />
                {isActive && (
                  <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                    <Check className="w-3 h-3 text-primary-foreground" />
                  </div>
                )}
              </div>
              <div className="px-2 py-1.5 bg-card/80">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="typo-body shrink-0">{lang.flag}</span>
                  <div className="min-w-0 flex-1 text-left">
                    <div className={`truncate ${isActive ? 'text-primary typo-card-label' : 'typo-card-label group-hover:text-foreground'}`}>{lang.label}</div>
                    {lang.code !== 'en' && (
                      <div className="typo-caption text-foreground truncate">{lang.english}</div>
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
