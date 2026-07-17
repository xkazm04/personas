import { Check } from 'lucide-react';
import { TEAM_COLORS } from './CreateTeamForm';

interface TeamColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
  /**
   * 'md' (default) shows the color name as a caption below each swatch —
   * used by CreateTeamForm. 'sm' is a compact grid with the name surfaced
   * only via title/aria-pressed — used by TeamWorkspacePane's identity panel.
   */
  size?: 'md' | 'sm';
}

/** Shared color-swatch grid for team identity editing (create + workspace pane). */
export function TeamColorPicker({ value, onChange, size = 'md' }: TeamColorPickerProps) {
  const swatchSize = size === 'md' ? 'w-9 h-9' : 'w-7 h-7';
  const checkSize = size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5';
  const gap = size === 'md' ? 'gap-2' : 'gap-1.5';

  return (
    <div className={`flex ${gap} flex-wrap`}>
      {Object.entries(TEAM_COLORS).map(([hex, name]) => {
        const isSelected = value === hex;
        const swatch = (
          <span
            className={`${swatchSize} rounded-card transition-all flex items-center justify-center ${isSelected ? 'scale-110' : 'hover:scale-105'}`}
            style={{ backgroundColor: hex }}
          >
            {isSelected && (
              <Check className={`${checkSize} text-foreground drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]`} />
            )}
          </span>
        );

        if (size === 'sm') {
          return (
            <button
              key={hex}
              type="button"
              onClick={() => onChange(hex)}
              title={name}
              aria-pressed={isSelected}
            >
              {swatch}
            </button>
          );
        }

        return (
          <button
            key={hex}
            type="button"
            onClick={() => onChange(hex)}
            className="flex flex-col items-center gap-1 group"
          >
            {swatch}
            <span className={`text-[10px] leading-tight ${isSelected ? 'text-foreground/90 font-medium' : 'text-foreground'}`}>
              {name}
            </span>
          </button>
        );
      })}
    </div>
  );
}
