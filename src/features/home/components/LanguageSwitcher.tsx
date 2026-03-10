import { useI18nStore, type Language } from '@/stores/i18nStore';
<<<<<<< HEAD
import { useThemeStore, THEMES } from '@/stores/themeStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Languages, X, Check } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

// ── Language data ──────────────────────────────────────────────────────────

interface LangEntry {
  code: Language;
  native: string;
  english: string;
  dark: string;
  light: string;
}

const LANGUAGES: LangEntry[] = [
  { code: 'ar', native: 'العربية', english: 'Arabic', dark: '/illustrations/languages/lang-ar.png', light: '/illustrations/languages/lang-ar-light.png' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali', dark: '/illustrations/languages/lang-bn.png', light: '/illustrations/languages/lang-bn-light.png' },
  { code: 'cs', native: 'Čeština', english: 'Czech', dark: '/illustrations/languages/lang-cs.png', light: '/illustrations/languages/lang-cs-light.png' },
  { code: 'de', native: 'Deutsch', english: 'German', dark: '/illustrations/languages/lang-de.png', light: '/illustrations/languages/lang-de-light.png' },
  { code: 'en', native: 'English', english: 'English', dark: '/illustrations/languages/lang-en.png', light: '/illustrations/languages/lang-en-light.png' },
  { code: 'es', native: 'Español', english: 'Spanish', dark: '/illustrations/languages/lang-es.png', light: '/illustrations/languages/lang-es-light.png' },
  { code: 'fr', native: 'Français', english: 'French', dark: '/illustrations/languages/lang-fr.png', light: '/illustrations/languages/lang-fr-light.png' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', dark: '/illustrations/languages/lang-hi.png', light: '/illustrations/languages/lang-hi-light.png' },
  { code: 'id', native: 'Bahasa Indonesia', english: 'Indonesian', dark: '/illustrations/languages/lang-id.png', light: '/illustrations/languages/lang-id-light.png' },
  { code: 'ja', native: '日本語', english: 'Japanese', dark: '/illustrations/languages/lang-ja.png', light: '/illustrations/languages/lang-ja-light.png' },
  { code: 'ko', native: '한국어', english: 'Korean', dark: '/illustrations/languages/lang-ko.png', light: '/illustrations/languages/lang-ko-light.png' },
  { code: 'ru', native: 'Русский', english: 'Russian', dark: '/illustrations/languages/lang-ru.png', light: '/illustrations/languages/lang-ru-light.png' },
  { code: 'vi', native: 'Tiếng Việt', english: 'Vietnamese', dark: '/illustrations/languages/lang-vi.png', light: '/illustrations/languages/lang-vi-light.png' },
  { code: 'zh', native: '中文', english: 'Chinese', dark: '/illustrations/languages/lang-zh.png', light: '/illustrations/languages/lang-zh-light.png' },
];

// ── Animation variants ─────────────────────────────────────────────────────

const backdropVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

const modalVariants = {
  hidden: { opacity: 0, scale: 0.92, y: 24 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring' as const, damping: 28, stiffness: 360 },
  },
  exit: { opacity: 0, scale: 0.95, y: 12, transition: { duration: 0.18 } },
};

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.04 * i, duration: 0.32, ease: [0.22, 1, 0.36, 1] as const },
  }),
};

// ── Modal content (portalled) ──────────────────────────────────────────────

function LanguageModal({
  language,
  isLight,
  onPick,
  onClose,
}: {
  language: Language;
  isLight: boolean;
  onPick: (code: Language) => void;
  onClose: () => void;
}) {
  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <motion.div
      key="lang-modal-backdrop"
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
      variants={backdropVariants}
      initial="hidden"
      animate="visible"
      exit="hidden"
    >
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        variants={modalVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="relative w-full max-w-[860px] max-h-[calc(100vh-3rem)] overflow-y-auto rounded-2xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-2xl"
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border/40 bg-card/90 backdrop-blur-md rounded-t-2xl">
          <div>
            <h2 className="typo-heading-lg text-foreground">Choose Language</h2>
            <p className="typo-caption text-muted-foreground mt-0.5">
              Select your preferred display language
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-5">
          {LANGUAGES.map((lang, i) => {
            const isActive = language === lang.code;
            const illustration = isLight ? lang.light : lang.dark;

            return (
              <motion.button
                key={lang.code}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                onClick={() => onPick(lang.code)}
                className={`group relative overflow-hidden rounded-xl border text-left transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                  isActive
                    ? 'border-primary/60 bg-primary/[0.07] ring-1 ring-primary/30 shadow-[0_0_24px_-4px] shadow-primary/20'
                    : 'border-border/40 bg-secondary/30 hover:border-border hover:bg-secondary/60'
                }`}
              >
                {/* Illustration background */}
                <div className="absolute inset-0 pointer-events-none">
                  <img
                    src={illustration}
                    alt=""
                    loading="lazy"
                    className={`w-full h-full object-cover transition-opacity duration-300 ${
                      isActive
                        ? 'opacity-[0.22]'
                        : 'opacity-[0.10] group-hover:opacity-[0.18]'
                    }`}
                  />
                  {/* Gradient overlay for text readability */}
                  <div className="absolute inset-0 bg-gradient-to-t from-card/90 via-card/50 to-transparent" />
                </div>

                {/* Content */}
                <div className="relative z-10 flex flex-col justify-end p-4 min-h-[120px]">
                  {/* Active indicator */}
                  {isActive && (
                    <div className="absolute top-3 right-3">
                      <div className="w-6 h-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center">
                        <Check className="w-3.5 h-3.5 text-primary" />
                      </div>
                    </div>
                  )}

                  {/* Native name */}
                  <span
                    className={`text-lg font-bold leading-tight tracking-tight transition-colors ${
                      isActive ? 'text-primary' : 'text-foreground group-hover:text-foreground'
                    }`}
                  >
                    {lang.native}
                  </span>

                  {/* English name */}
                  <span className="typo-caption text-muted-foreground mt-1">
                    {lang.english}
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ── Exported component ─────────────────────────────────────────────────────

export default function LanguageSwitcher() {
  const { language, setLanguage } = useI18nStore();
  const themeId = useThemeStore((s) => s.themeId);
  const [isOpen, setIsOpen] = useState(false);

  const isLight = THEMES.find((t) => t.id === themeId)?.isLight ?? false;

  const pick = useCallback(
    (code: Language) => {
      setLanguage(code);
      setIsOpen(false);
    },
    [setLanguage],
  );

  const current = LANGUAGES.find((l) => l.code === language);

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/50 border border-border/50 text-sm font-medium hover:bg-secondary transition-colors"
      >
        <Languages className="w-4 h-4 text-primary" />
        <span>{current?.native}</span>
      </button>

      {/* Portal modal to document.body — escapes all stacking contexts */}
      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <LanguageModal
              language={language}
              isLight={isLight}
              onPick={pick}
              onClose={() => setIsOpen(false)}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
=======
import { motion, AnimatePresence } from 'framer-motion';
import { Languages, Check } from 'lucide-react';
import { useState } from 'react';

const LANGUAGES: { code: Language; label: string; flag: string }[] = [
  { code: 'ar', label: 'العربية', flag: '🇸🇦' }, // Arabic
  { code: 'zh', label: '中文', flag: '🇨🇳' }, // Chinese
  { code: 'en', label: 'English', flag: '🇺🇸' },
  { code: 'hi', label: 'हिन्दी', flag: '🇮🇳' }, // Hindi
  { code: 'id', label: 'Bahasa Indonesia', flag: '🇮🇩' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
].sort((a, b) => {
  // Sort by English label if we had them, but since we have a mix, 
  // I'll manually order them or use a fixed sorted list based on English names:
  // Arabic, Chinese, English, Hindi, Indonesian, Russian
  const order = ['ar', 'zh', 'en', 'hi', 'id', 'ru'];
  return order.indexOf(a.code) - order.indexOf(b.code);
});

export default function LanguageSwitcher() {
  const { language, setLanguage } = useI18nStore();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/50 border border-border/50 text-sm font-medium hover:bg-secondary transition-colors"
      >
        <Languages className="w-4 h-4 text-primary" />
        <span>{LANGUAGES.find(l => l.code === language)?.label}</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setIsOpen(false)} 
            />
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              className="absolute top-full mt-2 right-0 w-48 rounded-xl bg-card border border-border shadow-xl z-50 overflow-hidden"
            >
              <div className="p-1">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => {
                      setLanguage(lang.code);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                      language === lang.code 
                        ? 'bg-primary/10 text-primary font-medium' 
                        : 'hover:bg-secondary text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span>{lang.flag}</span>
                      <span>{lang.label}</span>
                    </div>
                    {language === lang.code && <Check className="w-4 h-4" />}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  );
}
