// HoverCard — what a tile would say if it had the room, shown in the ONE
// delegated AnchoredTooltip the field owns. Inert like every tooltip: nothing
// in here is focusable or clickable; the tile's own press opens the drawer.

import type { CSSProperties } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { severityLabel, type PersonaCardModel } from '../monitorModel';
import { PILE_VISUAL, pileKey, pileOf } from './piles';
import { useTileState } from './Tile';
import { TEAMLESS_BAY, type Bay } from './boardModel';

export function HoverCard({ card, bay }: { card: PersonaCardModel; bay: Bay | undefined }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const visual = PILE_VISUAL[pileKey(card)];
  const Glyph = visual.glyph;
  const state = useTileState(card);
  const reviews = card.reviews.length > 0 ? card.reviews.length : card.reviewCount;
  const unread = card.messages.length > 0 ? card.messages.length : card.messageCount;
  const bayName = !bay ? null : bay.id === TEAMLESS_BAY ? m.board_teamless : bay.name;

  return (
    <div className="flex w-72 flex-col gap-2 py-1" style={{ '--fb-tone': visual.tone } as CSSProperties}>
      <div className="flex min-w-0 items-center gap-2.5">
        <PersonaIcon icon={card.personaIcon} color={card.personaColor} name={card.personaName} display="framed" frameSize="md" />
        <div className="min-w-0">
          <div className="typo-heading truncate text-foreground">{card.personaName}</div>
          {bayName && <div className="typo-caption truncate">{bayName}</div>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Glyph className="h-4 w-4 flex-shrink-0 fb-ink" aria-hidden />
        <span className="typo-label fb-ink">{state}</span>
        {pileOf(card) === 'working' && card.runningSince !== null && (
          <RelativeTime timestamp={card.runningSince} format="elapsed" showTooltip={false} className="typo-label text-foreground" />
        )}
      </div>

      {reviews > 0 && (
        <div className="typo-caption text-foreground">
          {tx(reviews === 1 ? m.board_hover_reviews_one : m.board_hover_reviews_other, { count: reviews })}
          {card.topReviewSeverity && ` · ${severityLabel(t, card.topReviewSeverity)}`}
        </div>
      )}
      {unread > 0 && (
        <div className="typo-caption text-foreground">
          {tx(unread === 1 ? m.board_hover_unread_one : m.board_hover_unread_other, { count: unread })}
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-primary/10 pt-2">
        {card.healthStatus && <span className="typo-label text-foreground">{m[`board_health_${card.healthStatus}`]}</span>}
        {card.successRate !== null && (
          <span className="typo-caption">
            <Numeric value={card.successRate} unit="ratio" precision={0} className="typo-data text-foreground" /> {m.board_success}
          </span>
        )}
        <span className="typo-caption">
          <Numeric value={card.runsToday} unit="count" className="typo-data text-foreground" /> {m.board_runs_today}
        </span>
      </div>
    </div>
  );
}
