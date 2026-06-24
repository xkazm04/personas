// PersonaSquare — the atom of the Fleet Grid.
//
// One persona = one small square with its initials, coloured by state (dark gray
// idle · pulsing theme running · warning needs-you · red failed). Clicking it
// selects the persona and opens the Monitor drawer on its most relevant section
// — the same affordance the columns view uses — so the grid is already wired for
// the future "click a square to act on the persona" interactions. Memoised so a
// fleet of hundreds only re-paints the squares whose state actually changed.

import { memo } from 'react';
import { primaryDrawerSection, type DrawerSection, type PersonaCardModel } from '../monitorModel';
import { squareState, SQUARE_VISUAL, initialsOf, cleanName } from './fleetGridModel';

export const PersonaSquare = memo(function PersonaSquare({
  card, selected, onSelect, size = 30,
}: {
  card: PersonaCardModel;
  selected: boolean;
  onSelect: (personaId: string, section: DrawerSection) => void;
  size?: number;
}) {
  const st = squareState(card);
  const v = SQUARE_VISUAL[st];
  // Scale the initials with the square so larger tiles stay balanced.
  const initialsClass = size >= 36 ? 'text-sm' : 'text-xs';
  return (
    <button
      type="button"
      onClick={() => onSelect(card.personaId, primaryDrawerSection(card))}
      title={cleanName(card.personaName)}
      aria-label={card.personaName}
      aria-pressed={selected}
      data-state={st}
      data-testid="fleet-grid-square"
      className={`relative inline-flex flex-shrink-0 items-center justify-center rounded-input border transition-all ${v.box} ${
        selected
          ? 'ring-2 ring-primary ring-offset-1 ring-offset-background'
          : 'hover:ring-1 hover:ring-inset hover:ring-foreground/25'
      }`}
      style={{ width: size, height: size }}
    >
      {/* Live-work pulse — only while executing (the user's "pulsing theme"). */}
      {v.pulse && (
        <span aria-hidden className="pointer-events-none absolute inset-0 rounded-input ring-1 ring-primary/70 animate-pulse" />
      )}
      <span className={`relative font-bold leading-none ${initialsClass} ${v.text}`}>{initialsOf(card.personaName)}</span>
    </button>
  );
});

export default PersonaSquare;
