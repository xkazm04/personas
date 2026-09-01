// PersonaTile — the atom of the Activity board.
//
// Was `PersonaSquare`: a 38px square carrying two-letter initials. The square
// was the right shape for "read a fleet of hundreds at a glance" and the wrong
// shape for "which persona is that" — initials collide (three personas beginning
// "Dev …" are all `DC`-ish) and the answer only ever lived in a native title
// tooltip, which is not a label. The tile is FOUR TIMES AS WIDE at exactly the
// same height, so the name is on the board and the tooltip goes back to being
// what it was for: the breakdown behind the badge.
//
// What did NOT change, deliberately:
//   • the state→colour decision (`squareState` + `SQUARE_VISUAL`), so a tile's
//     colour still agrees with every other Monitor surface;
//   • the badge (`actionBadges` head) and its priority order;
//   • the click contract — select the persona, open the drawer on its most
//     relevant section;
//   • `data-testid="fleet-grid-square"`, which the tour-anchor manifest and the
//     onboarding flows address. Renaming the component is not a reason to break
//     a published anchor.
//
// The state colour moved from the tile's fill to a full-height ACCENT RAIL on
// its leading edge. At 38×38 the fill WAS the signal; at 152×38 a saturated
// wash behind a name is just a legibility problem, and a rail reads the same
// four states down a column without competing with the text.

import { memo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { primaryDrawerSection, type DrawerSection, type PersonaCardModel } from '../monitorModel';
import {
  squareState, SQUARE_VISUAL, cleanName,
  actionBadges, type ActionKind,
} from './fleetGridModel';

/** Human phrase for one pending-operation kind, for the title tooltip. */
function badgeLine(
  t: ReturnType<typeof useTranslation>['t'],
  tx: ReturnType<typeof useTranslation>['tx'],
  kind: ActionKind,
  count: number,
): string {
  switch (kind) {
    case 'failed': return t.monitor.grid_badge_failed;
    case 'review': return tx(t.monitor.grid_badge_review, { count });
    case 'input': return tx(t.monitor.grid_badge_input, { count });
    case 'draft': return tx(t.monitor.grid_badge_draft, { count });
    case 'message': return tx(t.monitor.grid_badge_message, { count });
  }
}

export const PersonaTile = memo(function PersonaTile({
  card, selected, onSelect, width, height, flash = false,
}: {
  card: PersonaCardModel;
  selected: boolean;
  onSelect: (personaId: string, section: DrawerSection) => void;
  width: number;
  height: number;
  /** Athena pointed at this node — ring it until the board clears the signal. */
  flash?: boolean;
}) {
  const { t, tx } = useTranslation();
  const st = squareState(card);
  const v = SQUARE_VISUAL[st];

  // Highest-priority first, so the head is the one chip the tile shows.
  const badges = actionBadges(card);
  const dominant = badges[0] ?? null;
  const name = cleanName(card.personaName);
  const title = badges.length > 0
    ? `${name}\n${badges.map((b) => `• ${badgeLine(t, tx, b.key, b.count)}`).join('\n')}`
    : name;

  const Badge = dominant?.icon;

  return (
    <button
      type="button"
      onClick={() => onSelect(card.personaId, primaryDrawerSection(card))}
      title={title}
      aria-label={badges.length > 0 ? `${card.personaName} — ${badges.map((b) => badgeLine(t, tx, b.key, b.count)).join(', ')}` : card.personaName}
      aria-pressed={selected}
      data-state={st}
      data-action={dominant?.key ?? 'none'}
      data-testid="fleet-grid-square"
      className={`group relative flex flex-shrink-0 items-center gap-2 overflow-hidden rounded-input border pl-2 pr-1.5 text-left transition-colors ${
        selected
          ? 'border-primary/50 bg-primary/10'
          : 'border-border bg-foreground/[0.02] hover:border-primary/30 hover:bg-secondary/40'
      } ${flash ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`}
      style={{ width, height }}
    >
      {/* The state rail — the whole leading edge, so a column of tiles reads as
          a colour strip you can scan without reading a word (which is what the
          square's fill used to do). */}
      <span
        aria-hidden
        className={`absolute inset-y-0 left-0 w-1 ${v.accent} ${v.pulse ? 'animate-pulse' : ''}`}
      />

      <span className={`ml-1 min-w-0 flex-1 truncate typo-body ${st === 'idle' ? 'text-foreground/60' : 'text-foreground'}`}>
        {name}
      </span>

      {/* Operation chip — in flow at this width, not overlapping a corner: the
          tile has room, and a chip that overlaps nothing needs no cut-out ring. */}
      {dominant && Badge && (
        <span
          aria-hidden
          data-testid="fleet-grid-badge"
          className={`inline-flex h-[15px] min-w-[15px] flex-shrink-0 items-center justify-center gap-px rounded-full px-[3px] leading-none ${dominant.tone}`}
        >
          <Badge className="h-[10px] w-[10px] flex-shrink-0" />
          {dominant.count > 0 && (
            <span className="text-[9px] font-bold tabular-nums">
              {dominant.count > 9 ? '9+' : dominant.count}
            </span>
          )}
        </span>
      )}
    </button>
  );
});

export default PersonaTile;
