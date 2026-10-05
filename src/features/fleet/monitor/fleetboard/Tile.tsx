// Tile — one persona, drawn to be sorted by the eye before it is read.
//
//   needs   - a solid block of the tone with the reason as a big glyph
//   working - lit in the theme colour, a band sweeping through it, the run age
//   resting - a quiet glass tile that still names itself
//   off     - hatched
//
// Three sizes, picked by the layout from the tile's drawn size: SMALL is the
// initials and the glyph (or the run age); MEDIUM adds the persona's icon, its
// name and one meta line; LARGE adds the figures - health, success rate, the
// last ten runs and the last day's runs per hour.

import { memo, useCallback, type CSSProperties, type KeyboardEvent } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { PersonaCardModel } from '../monitorModel';
import { initialsOf } from '../grid/fleetGridModel';
import { TILE_ID_ATTR } from '../grid/useAttentionCursor';
import { usePersonaMenu } from '../grid/prototype/entry-e/PersonaMenu';
import { PILE_VISUAL, REASON_LABEL_KEY, needReason, pileKey, pileOf } from './piles';
import { NeedGlyph, RunStrip, Sparkline, SuccessBar } from './TileParts';
import type { Rect, Tier } from './layout';

interface TileProps {
  card: PersonaCardModel;
  rect: Rect;
  tier: Tier;
  /** Position in the field: staggers the working sweep so tiles do not march. */
  index: number;
  lit: boolean;
  selected: boolean;
  /** Runs per hour, oldest first (large tiles only). */
  hourly: readonly number[];
  onOpen: (card: PersonaCardModel) => void;
}

/** What the tile says about itself in one phrase: the reason, or the pile. */
export function useTileState(card: PersonaCardModel): string {
  const { t } = useTranslation();
  const reason = needReason(card);
  return reason ? t.monitor[REASON_LABEL_KEY[reason]] : t.monitor[PILE_VISUAL[pileKey(card)].labelKey];
}

function Meta({ card, state }: { card: PersonaCardModel; state: string }) {
  if (pileOf(card) === 'working' && card.runningSince !== null) {
    return <RelativeTime timestamp={card.runningSince} format="elapsed" showTooltip={false} className="typo-label whitespace-nowrap" />;
  }
  return <span className="typo-label truncate">{state}</span>;
}

export const Tile = memo(function Tile({ card, rect, tier, index, lit, selected, hourly, onOpen }: TileProps) {
  const { tx, t } = useTranslation();
  const pile = pileOf(card);
  const key = pileKey(card);
  const state = useTileState(card);
  const menu = usePersonaMenu(card);
  const open = useCallback(() => onOpen(card), [onOpen, card]);
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      open();
      return;
    }
    menu.onKeyDown(e);
  }, [open, menu]);

  const style = {
    left: rect.x, top: rect.y, width: rect.w, height: rect.h,
    '--fb-tone': PILE_VISUAL[key].tone,
    '--fb-sd': `${-((index * 0.37) % 3.2)}s`,
  } as CSSProperties;
  const cls = `fb-tile is-${pile}${key === 'critical' ? ' is-critical' : ''}${lit ? ' is-lit' : ''}${selected ? ' is-selected' : ''}`;
  const needs = pile === 'needs';

  return (
    <div
      role="button"
      tabIndex={0}
      {...{ [TILE_ID_ATTR]: card.personaId }}
      aria-label={tx(t.monitor.board_tile_aria, { name: card.personaName, state })}
      aria-pressed={selected}
      className={cls}
      style={style}
      onClick={open}
      onKeyDown={onKeyDown}
      onContextMenu={menu.onContextMenu}
    >
      {tier === 'small' ? (
        <span className="fb-tile__body items-center" aria-hidden>
          <span className="typo-heading">{initialsOf(card.personaName)}</span>
          <span className="fb-grow" />
          {pile === 'working' && <span className="fb-hide-narrow"><Meta card={card} state={state} /></span>}
          {needs && <NeedGlyph card={card} size="sm" />}
        </span>
      ) : (
        <span className="fb-tile__body is-stack" aria-hidden>
          <span className="fb-tile__row flex min-w-0 items-center gap-2">
            <PersonaIcon icon={card.personaIcon} color={card.personaColor} name={card.personaName} display="framed" frameSize="md" frameClass="fb-face" />
            <span className="typo-heading fb-clamp2 fb-grow">{card.personaName}</span>
          </span>
          <span className={`flex min-w-0 items-center gap-2${tier === 'medium' ? ' mt-auto' : ''}`}>
            {needs && <NeedGlyph card={card} size={tier === 'large' ? 'lg' : 'md'} />}
            <span className="fb-grow truncate"><Meta card={card} state={state} /></span>
          </span>
          {tier === 'large' && (
            <span className="mt-auto flex min-w-0 flex-col gap-1.5">
              <span className="flex min-w-0 items-center gap-2">
                <SuccessBar rate={card.successRate} />
                {card.healthStatus && <span className="typo-label">{t.monitor[`board_health_${card.healthStatus}`]}</span>}
              </span>
              <span className="flex min-w-0 items-end gap-2">
                <RunStrip card={card} />
                <Sparkline buckets={hourly} />
              </span>
            </span>
          )}
        </span>
      )}
    </div>
  );
});
