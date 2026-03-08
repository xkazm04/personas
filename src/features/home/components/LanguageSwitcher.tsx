import { useI18nStore, type Language } from '@/stores/i18nStore';
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
  );
}
