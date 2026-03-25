import { useI18nStore, type Language } from '@/stores/i18nStore';
import { Languages, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/features/shared/components/buttons';

const LANGUAGES = ([
  { code: 'ar' as const, label: 'العربية', flag: '🇸🇦' },
  { code: 'zh' as const, label: '中文', flag: '🇨🇳' },
  { code: 'en' as const, label: 'English', flag: '🇺🇸' },
  { code: 'hi' as const, label: 'हिन्दी', flag: '🇮🇳' },
  { code: 'id' as const, label: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'ru' as const, label: 'Русский', flag: '🇷🇺' },
] satisfies { code: Language; label: string; flag: string }[]).sort((a, b) => {
  const order: Language[] = ['ar', 'zh', 'en', 'hi', 'id', 'ru'];
  return order.indexOf(a.code) - order.indexOf(b.code);
});

/** Map language code to illustration file (dark variant). */
function langIllustration(code: string) {
  return `/illustrations/languages/lang-${code}.png`;
}

/** Inline card grid for embedding in Welcome page */
export function LanguageCardGrid() {
  const { language, setLanguage } = useI18nStore();
  return (
    <div>
      <div className="animate-fade-slide-in grid grid-cols-3 sm:grid-cols-6 gap-2">
        {LANGUAGES.map((lang) => {
          const isActive = language === lang.code;
          return (
            <button
              key={lang.code}
              type="button"
              onClick={() => setLanguage(lang.code)}
              className={`group relative overflow-hidden rounded-xl border transition-all ${
                isActive ? 'ring-2 ring-primary/60 border-primary/30 shadow-md' : 'border-primary/10 hover:border-primary/25 hover:ring-1 hover:ring-primary/20'
              }`}
            >
              <div className="relative aspect-[4/3] bg-secondary/30 overflow-hidden">
                <img src={langIllustration(lang.code)} alt="" loading="lazy" decoding="async"
                  className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 ${isActive ? 'opacity-90 scale-100' : 'opacity-30 scale-105 group-hover:opacity-85 group-hover:scale-100'}`} />
                <div className={`absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent transition-opacity ${isActive ? 'opacity-80' : 'opacity-40 group-hover:opacity-70'}`} />
                {isActive && (
                  <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                    <Check className="w-3 h-3 text-primary-foreground" />
                  </div>
                )}
              </div>
              <div className="px-2 py-1.5 bg-card/80">
                <div className="flex items-center gap-1.5">
                  <span className="typo-caption">{lang.flag}</span>
                  <span className={`typo-caption truncate ${isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`}>{lang.label}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function LanguageSwitcher() {
  const { language, setLanguage } = useI18nStore();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="md"
        icon={<Languages className="w-4 h-4 text-primary" />}
        onClick={() => setIsOpen(!isOpen)}
      >
        {LANGUAGES.find(l => l.code === language)?.label}
      </Button>

      {isOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setIsOpen(false)}
            />
            <div
              className="animate-fade-slide-in absolute top-full mt-2 right-0 rounded-xl bg-card border border-border shadow-xl z-50 overflow-hidden p-2"
            >
              {/* Card grid with illustration backgrounds */}
              <div className="grid grid-cols-3 gap-2" style={{ width: '340px' }}>
                {LANGUAGES.map((lang) => {
                  const isActive = language === lang.code;
                  return (
                    <Button
                      key={lang.code}
                      variant="ghost"
                      size="md"
                      onClick={() => {
                        setLanguage(lang.code);
                        setIsOpen(false);
                      }}
                      className={`group relative overflow-hidden text-left p-0 h-auto ${
                        isActive
                          ? 'ring-2 ring-primary/60 shadow-md'
                          : 'hover:ring-1 hover:ring-primary/30'
                      }`}
                    >
                      {/* Illustration background */}
                      <div className="relative aspect-[4/3] bg-secondary/30 overflow-hidden">
                        <img
                          src={langIllustration(lang.code)}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 ${
                            isActive
                              ? 'opacity-90 scale-100'
                              : 'opacity-30 scale-105 group-hover:opacity-85 group-hover:scale-100'
                          }`}
                        />
                        {/* Overlay gradient */}
                        <div className={`absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent transition-opacity duration-300 ${
                          isActive ? 'opacity-80' : 'opacity-40 group-hover:opacity-70'
                        }`} />
                        {/* Check badge */}
                        {isActive && (
                          <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="w-3 h-3 text-primary-foreground" />
                          </div>
                        )}
                      </div>
                      {/* Label below */}
                      <div className="px-2 py-1.5 bg-card/80">
                        <div className="flex items-center gap-1.5">
                          <span className="typo-caption">{lang.flag}</span>
                          <span className={`typo-caption truncate ${isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`}>
                            {lang.label}
                          </span>
                        </div>
                      </div>
                    </Button>
                  );
                })}
              </div>
            </div>
          </>
        )}
    </div>
  );
}
