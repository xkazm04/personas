import { Check } from 'lucide-react';
import { THEMES } from '@/stores/themeStore';
import type { ThemeId } from '@/stores/themeStore';

interface ThemeSwatchGridProps {
  /** Which half of the catalog to show. */
  light: boolean;
  activeId: ThemeId;
  onPick: (id: ThemeId) => void;
}

/** One 4-column grid of theme swatches (dark or light half of THEMES). */
export function ThemeSwatchGrid({ light, activeId, onPick }: ThemeSwatchGridProps) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {THEMES.filter((t) => t.isLight === light).map((t) => {
        const isActive = activeId === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onPick(t.id as ThemeId)}
            className={`flex flex-col items-center gap-1 p-1.5 rounded-lg transition-all ${
              isActive ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-secondary/50'
            }`}
          >
            <span
              className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-transform ${
                isActive
                  ? 'border-foreground/60 scale-110'
                  : `${light ? 'border-black/10' : 'border-transparent'} hover:scale-105`
              }`}
              style={{ backgroundColor: t.primaryColor }}
            >
              {isActive && <Check className="w-3 h-3 text-foreground drop-shadow-elevation-1" />}
            </span>
            <span className={`text-[9px] leading-tight truncate w-full text-center ${
              isActive ? 'text-foreground/90 font-medium' : 'text-foreground'
            }`}>
              {t.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
