import { useState, useRef, useCallback } from 'react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { Palette } from 'lucide-react';
import { useThemeStore, THEMES } from '@/stores/themeStore';
import type { ThemeId } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';
import { ThemeSwatchGrid } from './ThemeSwatchGrid';

// Theme icon -- quick theme picker popup.

export default function ThemeFooterIcon() {
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t: tTheme } = useTranslation();

  const currentTheme = THEMES.find((t) => t.id === themeId);

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  const pick = (id: ThemeId) => { setTheme(id); setOpen(false); };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        data-testid="footer-theme"
        className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors group"
        title={`Theme: ${currentTheme?.label ?? 'Default'}`}
        aria-label={`Theme: ${currentTheme?.label ?? 'Default'}`}
      >
        <div className="relative">
          <Palette className="w-5 h-5" />
          {/* Tiny swatch dot showing current primary */}
          <span
            className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-background"
            style={{ backgroundColor: currentTheme?.primaryColor ?? '#3b82f6' }}
          />
        </div>
      </button>

      {open && (
        <div className="animate-fade-slide-in absolute bottom-full left-0 mb-2 w-[220px] rounded-xl border border-primary/15 bg-background shadow-elevation-3 p-3 z-50">
          <p className="text-[10px] font-mono uppercase tracking-wider text-foreground mb-2">{tTheme.chrome.dark}</p>
          <div className="mb-3">
            <ThemeSwatchGrid light={false} activeId={themeId} onPick={pick} />
          </div>
          <div className="border-t border-primary/10 pt-2">
            <p className="text-[10px] font-mono uppercase tracking-wider text-foreground mb-2">{tTheme.chrome.light}</p>
            <ThemeSwatchGrid light activeId={themeId} onPick={pick} />
          </div>
        </div>
      )}
    </div>
  );
}
