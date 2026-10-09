// PROTOTYPE ROUND (spark council-readout). The ONE whole-surface press target
// the Scoreboard needs: a band column is a tab whose whole face is the
// control, and the shared `Button` has no class merge to become one. This is
// the visible +1 on `raw-button-element`, declared rather than hidden.
import type { KeyboardEvent, ReactNode } from 'react';

export function BandTab({
  id,
  panelId,
  selected,
  hollow,
  anchor,
  label,
  onSelect,
  onKeyDown,
  children,
}: {
  id: string;
  panelId: string;
  selected: boolean;
  hollow?: boolean;
  anchor?: boolean;
  label: string;
  onSelect: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={selected}
      aria-controls={panelId}
      aria-label={label}
      tabIndex={selected ? 0 : -1}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      className={`sb-tile focus-ring ${anchor ? 'is-anchor' : ''} ${hollow ? 'is-hollow' : ''}`}
    >
      {children}
    </button>
  );
}
