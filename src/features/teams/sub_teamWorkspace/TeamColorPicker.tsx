import { Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

/** Catalog keys (t.pipeline.*) naming each palette colour. */
type TeamColorKey =
  | 'team_color_indigo' | 'team_color_violet' | 'team_color_pink' | 'team_color_rose' | 'team_color_orange'
  | 'team_color_yellow' | 'team_color_green' | 'team_color_cyan' | 'team_color_blue';

/**
 * Team identity palette. Lived in `CreateTeamForm` until team creation was
 * retired (2026-08-26 — a project now owns exactly one team, created with it);
 * moved here, its only remaining consumer.
 */
export const TEAM_COLORS: Record<string, TeamColorKey> = {
  '#6366f1': 'team_color_indigo',
  '#8b5cf6': 'team_color_violet',
  '#ec4899': 'team_color_pink',
  '#f43f5e': 'team_color_rose',
  '#f97316': 'team_color_orange',
  '#eab308': 'team_color_yellow',
  '#22c55e': 'team_color_green',
  '#06b6d4': 'team_color_cyan',
  '#3b82f6': 'team_color_blue',
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
  const { t } = useTranslation();
  return (
    <div className="flex gap-1.5 flex-wrap">
      {Object.entries(TEAM_COLORS).map(([hex, nameKey]) => {
        const name = t.pipeline[nameKey];
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
