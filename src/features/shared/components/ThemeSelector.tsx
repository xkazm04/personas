import { useState, useRef, useEffect } from 'react';
import { Palette } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useThemeStore, THEMES } from '@/stores/themeStore';
import type { ThemeId } from '@/stores/themeStore';

export default function ThemeSelector() {
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const darkThemes = THEMES.filter((t) => !t.isLight);
  const lightThemes = THEMES.filter((t) => t.isLight);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(!open)}
        className="w-11 h-11 rounded-xl flex items-center justify-center transition-all group
          hover:bg-primary/10 border border-transparent hover:border-primary/20"
        title="Theme"
      >
        <Palette className="w-5 h-5 transition-colors text-muted-foreground/50 group-hover:text-foreground/70" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full left-full ml-2 mb-0 w-56 rounded-xl
              bg-secondary border border-primary/15 shadow-xl z-50 p-3 overflow-hidden"
          >
            <div className="text-[11px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">
              Dark
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {darkThemes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTheme(t.id as ThemeId);
                    setOpen(false);
                  }}
                  className={`w-7 h-7 rounded-full transition-all ${
                    themeId === t.id
                      ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                      : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: t.primaryColor }}
                  title={t.label}
                />
              ))}
            </div>

            <div className="border-t border-primary/10 pt-2">
              <div className="text-[11px] font-mono text-muted-foreground/50 uppercase tracking-wider mb-2">
                Light
              </div>
              <div className="flex flex-wrap gap-2">
                {lightThemes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setTheme(t.id as ThemeId);
                      setOpen(false);
                    }}
                    className={`w-7 h-7 rounded-full transition-all border border-black/10 ${
                      themeId === t.id
                        ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                        : 'hover:scale-110'
                    }`}
                    style={{ backgroundColor: t.primaryColor }}
                    title={t.label}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
