// PersonaSquare — the atom of the Fleet Grid.
//
// One persona = one small square with its initials, coloured by state (dark gray
// idle · pulsing theme running · warning needs-you · red failed). Clicking it
// selects the persona and opens the Monitor drawer on its most relevant section
// — the same affordance the columns view uses — so the grid is already wired for
// the future "click a square to act on the persona" interactions. Memoised so a
// fleet of hundreds only re-paints the squares whose state actually changed.
//
// The square's COLOUR says what the persona is doing; the corner BADGE says what
// kind of operation is waiting on the user (report · review · input gate · draft
// · failed run). At 38px there is no room for a badge row, so the square carries
// exactly one chip — the highest-priority pending operation — and the full
// breakdown goes in the native title tooltip, which is also where the badge's
// meaning is spelled out for anyone who doesn't read the icon.

import { memo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { primaryDrawerSection, type DrawerSection, type PersonaCardModel } from '../monitorModel';
import {
  squareState, SQUARE_VISUAL, initialsOf, cleanName,
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

export const PersonaSquare = memo(function PersonaSquare({
  card, selected, onSelect, size = 30,
}: {
  card: PersonaCardModel;
  selected: boolean;
  onSelect: (personaId: string, section: DrawerSection) => void;
  size?: number;
}) {
  const { t, tx } = useTranslation();
  const st = squareState(card);
  const v = SQUARE_VISUAL[st];
  // Scale the initials with the square so larger tiles stay balanced.
  const initialsClass = size >= 36 ? 'text-sm' : 'text-xs';

  // Highest-priority first, so the head is the one chip the square can show.
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

      {/* Operation chip — overlaps the top-right corner so it never eats into
          the initials. `ring-background` cuts it out of whatever square colour
          sits behind it, in either theme. */}
      {dominant && Badge && (
        <span
          aria-hidden
          data-testid="fleet-grid-badge"
          className={`pointer-events-none absolute -right-1 -top-1 inline-flex h-[13px] min-w-[13px] items-center justify-center gap-px rounded-full px-[3px] leading-none ring-1 ring-background ${dominant.tone}`}
        >
          <Badge className="h-[9px] w-[9px] flex-shrink-0" />
          {dominant.count > 0 && (
            <span className="text-[8px] font-bold tabular-nums">
              {dominant.count > 9 ? '9+' : dominant.count}
            </span>
          )}
        </span>
      )}
    </button>
  );
});

export default PersonaSquare;
