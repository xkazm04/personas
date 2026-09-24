/**
 * One selectable card in the forge's voice picker — used both for the three
 * tiles in the main sight and for the ten presets one layer down.
 */

import type { ReactNode } from 'react';

interface StyleTileProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  body: string;
  icon: ReactNode;
  testId: string;
}

export function StyleTile({ selected, onSelect, title, body, icon, testId }: StyleTileProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={testId}
      className={`focus-ring text-left flex gap-2.5 rounded-card border px-3 py-3 transition-colors min-h-[5rem] ${
        selected
          ? 'border-primary bg-primary/10 shadow-elevation-2'
          : 'border-primary/15 bg-card-bg hover:border-primary/40 hover:shadow-elevation-1'
      }`}
    >
      <span className="mt-0.5 flex-shrink-0 text-primary" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block typo-title text-foreground">{title}</span>
        <span className="block typo-caption">{body}</span>
      </span>
    </button>
  );
}

export default StyleTile;
