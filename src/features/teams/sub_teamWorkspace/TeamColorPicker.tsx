import { Check } from 'lucide-react';

/**
 * Team identity palette. Lived in `CreateTeamForm` until team creation was
 * retired (2026-08-26 — a project now owns exactly one team, created with it);
 * moved here, its only remaining consumer.
 */
export const TEAM_COLORS: Record<string, string> = {
  '#6366f1': 'Indigo',
  '#8b5cf6': 'Violet',
  '#ec4899': 'Pink',
  '#f43f5e': 'Rose',
  '#f97316': 'Orange',
  '#eab308': 'Yellow',
  '#22c55e': 'Green',
  '#06b6d4': 'Cyan',
  '#3b82f6': 'Blue',
};

interface TeamColorPickerProps {
  value: string;
  onChange: (hex: string) => void;
}

/**
 * Compact color-swatch grid for team identity editing (TeamWorkspacePane's
 * identity panel). The labelled 'md' variant went with its only consumer,
 * the retired `CreateTeamForm`.
 */
export function TeamColorPicker({ value, onChange }: TeamColorPickerProps) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {Object.entries(TEAM_COLORS).map(([hex, name]) => {
        const isSelected = value === hex;
        return (
          <button
            key={hex}
            type="button"
            onClick={() => onChange(hex)}
            title={name}
            aria-pressed={isSelected}
          >
            <span
              className={`w-7 h-7 rounded-card transition-all flex items-center justify-center ${isSelected ? 'scale-110' : 'hover:scale-105'}`}
              style={{ backgroundColor: hex }}
            >
              {isSelected && (
                <Check className="w-3.5 h-3.5 text-foreground drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
