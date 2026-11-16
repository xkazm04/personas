/**
 * One selectable card in the forge's voice picker — used both for the three
 * tiles in the main sight and for the ten presets one layer down.
 */

import type { ReactNode } from 'react';
import { PressSurface } from '@/features/shared/components/buttons';

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
    <PressSurface
      onPress={onSelect}
      aria-pressed={selected}
      data-testid={testId}
      className="flex gap-2.5 rounded-card border border-hair px-3 py-3 min-h-[5rem]"
      selected={selected}
    >
      <span className="mt-0.5 flex-shrink-0 text-primary" aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block typo-title text-foreground">{title}</span>
        <span className="block typo-caption">{body}</span>
      </span>
    </PressSurface>
  );
}

export default StyleTile;
