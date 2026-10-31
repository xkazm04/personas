import type { ReactNode } from 'react';
import { Check } from 'lucide-react';

interface AppearanceOptionTileProps {
  active: boolean;
  onSelect: () => void;
  /** Optional glyph above the label (icon, or the "Aa" sample for text size). */
  icon?: ReactNode;
  label: string;
  description?: string;
}

/** Selectable tile shared by the Appearance pickers (brightness, density, text size, timezone). */
export function AppearanceOptionTile({ active, onSelect, icon, label, description }: AppearanceOptionTileProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`relative flex flex-col items-center gap-2 p-4 rounded-modal border transition-colors text-center ${
        active
          ? 'border-primary/30 bg-primary/5'
          : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
      }`}
    >
      {icon}
      <span className="typo-heading text-foreground">{label}</span>
      {description && <span className="typo-caption text-foreground">{description}</span>}
      {active && (
        <div className="absolute top-2 right-2">
          <Check className="w-3.5 h-3.5 text-primary" />
        </div>
      )}
    </button>
  );
}
