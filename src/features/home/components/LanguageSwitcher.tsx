import { useI18nStore, type Language } from '@/stores/i18nStore';
import { motion, AnimatePresence } from 'framer-motion';
import { Languages, X, Check } from 'lucide-react';
import { useState, useCallback } from 'react';

const LANGUAGES: {
  code: Language;
  native: string;
  english: string;
  illustration: string;
}[] = [
  { code: 'ar', native: 'العربية', english: 'Arabic', illustration: '/illustrations/languages/lang-ar.png' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali', illustration: '/illustrations/languages/lang-bn.png' },
  { code: 'cs', native: 'Čeština', english: 'Czech', illustration: '/illustrations/languages/lang-cs.png' },
  { code: 'de', native: 'Deutsch', english: 'German', illustration: '/illustrations/languages/lang-de.png' },
  { code: 'en', native: 'English', english: 'English', illustration: '/illustrations/languages/lang-en.png' },
  { code: 'es', native: 'Español', english: 'Spanish', illustration: '/illustrations/languages/lang-es.png' },
  { code: 'fr', native: 'Français', english: 'French', illustration: '/illustrations/languages/lang-fr.png' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi', illustration: '/illustrations/languages/lang-hi.png' },
  { code: 'id', native: 'Bahasa Indonesia', english: 'Indonesian', illustration: '/illustrations/languages/lang-id.png' },
  { code: 'ja', native: '日本語', english: 'Japanese', illustration: '/illustrations/languages/lang-ja.png' },
  { code: 'ko', native: '한국어', english: 'Korean', illustration: '/illustrations/languages/lang-ko.png' },
  { code: 'ru', native: 'Русский', english: 'Russian', illustration: '/illustrations/languages/lang-ru.png' },
  { code: 'vi', native: 'Tiếng Việt', english: 'Vietnamese', illustration: '/illustrations/languages/lang-vi.png' },
  { code: 'zh', native: '中文', english: 'Chinese', illustration: '/illustrations/languages/lang-zh.png' },
];

// ── Backdrop ───────────────────────────────────────────────────────────────

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

// ── Component ──────────────────────────────────────────────────────────────

export default function LanguageSwitcher() {
  const { language, setLanguage } = useI18nStore();
  const [isOpen, setIsOpen] = useState(false);

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

      {/* Modal */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            key="lang-modal-backdrop"
            className="fixed inset-0 z-[100] flex items-center justify-center p-6"
            variants={backdropVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
          >
            {/* Scrim */}
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
              onClick={() => setIsOpen(false)}
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
                  onClick={() => setIsOpen(false)}
                  className="p-2 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-5">
                {LANGUAGES.map((lang, i) => {
                  const isActive = language === lang.code;
                  return (
                    <motion.button
                      key={lang.code}
                      custom={i}
                      variants={cardVariants}
                      initial="hidden"
                      animate="visible"
                      onClick={() => pick(lang.code)}
                      className={`group relative overflow-hidden rounded-xl border text-left transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                        isActive
                          ? 'border-primary/60 bg-primary/[0.07] ring-1 ring-primary/30 shadow-[0_0_24px_-4px] shadow-primary/20'
                          : 'border-border/40 bg-secondary/30 hover:border-border hover:bg-secondary/60'
                      }`}
                    >
                      {/* Illustration background */}
                      <div className="absolute inset-0 pointer-events-none">
                        <img
                          src={lang.illustration}
                          alt=""
                          loading="lazy"
                          className={`w-full h-full object-cover transition-opacity duration-300 ${
                            isActive
                              ? 'opacity-[0.18]'
                              : 'opacity-[0.08] group-hover:opacity-[0.15]'
                          }`}
                        />
                        {/* Gradient overlay to keep text readable */}
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

                        {/* Native name — rendered in the language's own typography */}
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
        )}
      </AnimatePresence>
    </>
  );
}
