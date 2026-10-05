// NeedsRail — who is waiting on a human, ranked, one compact row each: the
// tone, the persona's face, its name and reason, and how long it has waited.
// Hovering a row lights its tile on the field; pressing one opens the drawer.
//
// The scroller is the Monitor's shared `RailList` (virtualized above thirty
// rows - at a hundred personas most of the fleet can need you). It speaks
// `RailRow`, so each persona is projected into one; the projection carries
// only what the list reads (`id`) honestly and the row renders from the card.

import { memo, useCallback, useMemo, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { PersonaCardModel } from '../monitorModel';
import { RailList } from '../grid/rail/RailList';
import type { RailRow } from '../grid/rail/railModel';
import { PILE_VISUAL, needTone } from './piles';
import { useTileState } from './Tile';

const ROW_H = 56;
const rowHeight = () => ROW_H;
const noop = () => undefined;

/** How long it has waited: its oldest pending review or unread message, when loaded. */
function waitingSince(card: PersonaCardModel): string | null {
  const stamps = [...card.reviews.map((r) => r.created_at), ...card.messages.map((m) => m.created_at)];
  return stamps.length > 0 ? stamps.reduce((a, b) => (a < b ? a : b)) : null;
}

function toRow(card: PersonaCardModel): RailRow {
  return {
    id: card.personaId, tone: needTone(card) === 'critical' ? 'danger' : 'warning', code: '', kind: '',
    icon: PILE_VISUAL[needTone(card)].glyph, title: card.personaName, source: null, at: waitingSince(card),
    body: null, accent: card.personaColor, persona: { icon: card.personaIcon, color: card.personaColor },
    unread: false, selectable: false, decidable: false, groupHeader: null, showTime: true,
    tracksRead: false, showKind: false,
  };
}

const RailItem = memo(function RailItem({ card, lit, onOpen, onLight }: {
  card: PersonaCardModel;
  lit: boolean;
  onOpen: (card: PersonaCardModel) => void;
  onLight: (personaId: string | null) => void;
}) {
  const { t, tx } = useTranslation();
  const state = useTileState(card);
  const since = waitingSince(card);
  const open = () => onOpen(card);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    open();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      data-rail-persona={card.personaId}
      aria-label={tx(t.monitor.board_tile_aria, { name: card.personaName, state })}
      className={`fb-rail__row${lit ? ' is-lit' : ''}`}
      style={{ '--fb-tone': PILE_VISUAL[needTone(card)].tone } as CSSProperties}
      onClick={open}
      onKeyDown={onKeyDown}
      onPointerEnter={() => onLight(card.personaId)}
      onPointerLeave={() => onLight(null)}
      onFocus={() => onLight(card.personaId)}
      onBlur={() => onLight(null)}
    >
      <i className="fb-rail__bar" aria-hidden />
      <PersonaIcon icon={card.personaIcon} color={card.personaColor} name={card.personaName} display="framed" frameSize="md" />
      <span className="min-w-0" aria-hidden>
        <span className="block truncate typo-body text-foreground">{card.personaName}</span>
        <span className="block truncate typo-label fb-ink">{state}</span>
      </span>
      {since && <RelativeTime timestamp={since} format="elapsed" showTooltip={false} className="typo-label text-foreground" />}
    </div>
  );
});

export const NeedsRail = memo(function NeedsRail({ queue, litId, loading, onOpen, onLight }: {
  queue: PersonaCardModel[];
  litId: string | null;
  loading: boolean;
  onOpen: (card: PersonaCardModel) => void;
  onLight: (personaId: string | null) => void;
}) {
  const { t } = useTranslation();
  const rows = useMemo(() => queue.map(toRow), [queue]);
  const byId = useMemo(() => new Map(queue.map((c) => [c.personaId, c])), [queue]);
  const renderRow = useCallback((row: RailRow) => {
    const card = byId.get(row.id);
    return card ? <RailItem card={card} lit={litId === card.personaId} onOpen={onOpen} onLight={onLight} /> : null;
  }, [byId, litId, onOpen, onLight]);

  return (
    <aside className="fb-rail" aria-label={t.monitor.board_rail_aria}>
      <div className="flex flex-shrink-0 items-baseline justify-between px-3 pb-1.5 pt-2.5">
        <h3 className="typo-eyebrow text-foreground">{t.monitor.board_pile_needs}</h3>
        {!loading && <Numeric value={queue.length} unit="count" className="typo-data text-foreground" />}
      </div>
      <div className="flex min-h-0 flex-1 flex-col px-1.5 pb-1.5">
        <RailList
          rows={rows}
          heightOf={rowHeight}
          renderRow={renderRow}
          hasMore={false}
          loading={loading}
          onEndReached={noop}
          empty={<p className="px-2 py-3 typo-body text-foreground">{t.monitor.board_rail_empty}</p>}
          testId="monitor-board-rail"
        />
      </div>
    </aside>
  );
});
