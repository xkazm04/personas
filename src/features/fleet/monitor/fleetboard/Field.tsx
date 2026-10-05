// Field — the bays and their tiles, absolutely placed by the pure layout, and
// ONE hover card for all of them. Hover and focus are tracked by a single
// delegated handler on the field (a hundred tiles must not carry a hundred
// tooltips), which reports the tile under the pointer or the keyboard.

import { memo, useCallback, useMemo, useState, type FocusEvent, type PointerEvent } from 'react';
import { AnchoredTooltip } from '@/features/shared/components/display/Tooltip';
import type { PersonaCardModel } from '../monitorModel';
import { TILE_ID_ATTR } from '../grid/useAttentionCursor';
import { PersonaMenuProvider } from '../grid/prototype/entry-e/PersonaMenu';
import { layoutField } from './layout';
import type { BoardShape } from './boardModel';
import type { HourlyRuns } from './useBoardData';
import { BayFrame } from './BayFrame';
import { Tile } from './Tile';
import { HoverCard } from './HoverCard';

const ZERO_DAY: readonly number[] = Array<number>(24).fill(0);

interface FieldProps {
  board: BoardShape;
  width: number;
  height: number;
  litId: string | null;
  selectedPersonaId: string | null;
  hourly: HourlyRuns;
  onOpen: (card: PersonaCardModel) => void;
  onZoomTeam: (teamId: string) => void;
  /** The persona under the pointer or the keyboard (lights its rail row), or null. */
  onLight: (personaId: string | null) => void;
}

function tileUnder(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(`[${TILE_ID_ATTR}]`) : null;
}

export const Field = memo(function Field({
  board, width, height, litId, selectedPersonaId, hourly, onOpen, onZoomTeam, onLight,
}: FieldProps) {
  const layout = useMemo(
    () => layoutField(board.bays.map((b) => ({ id: b.id, count: b.cards.length })), width, height),
    [board.bays, width, height],
  );
  const [tip, setTip] = useState<{ id: string; anchor: DOMRect } | null>(null);

  const report = useCallback((el: HTMLElement | null) => {
    const id = el?.getAttribute(TILE_ID_ATTR) ?? null;
    setTip((cur) => (cur?.id === id ? cur : id && el ? { id, anchor: el.getBoundingClientRect() } : null));
    onLight(id);
  }, [onLight]);
  const onPointerOver = useCallback((e: PointerEvent) => report(tileUnder(e.target)), [report]);
  const onFocus = useCallback((e: FocusEvent) => report(tileUnder(e.target)), [report]);
  const clear = useCallback(() => report(null), [report]);

  const tipCard = tip ? board.bayOf.get(tip.id)?.cards.find((c) => c.personaId === tip.id) : undefined;
  let index = 0;

  return (
    <PersonaMenuProvider>
      <div
        className="absolute inset-0"
        onPointerOver={onPointerOver}
        onPointerLeave={clear}
        onFocus={onFocus}
        onBlur={clear}
      >
        {board.bays.map((bay, b) => {
          const laid = layout[b];
          if (!laid) return null;
          return (
            <div key={bay.id} className="contents">
              <BayFrame bay={bay} rect={laid.rect} onZoom={onZoomTeam} />
              {bay.cards.map((card, k) => (
                <Tile
                  key={card.personaId}
                  card={card}
                  rect={laid.tiles[k]!}
                  tier={laid.tier}
                  index={index++}
                  lit={litId === card.personaId}
                  selected={selectedPersonaId === card.personaId}
                  hourly={laid.tier === 'large' ? hourly.get(card.personaId) ?? ZERO_DAY : ZERO_DAY}
                  onOpen={onOpen}
                />
              ))}
            </div>
          );
        })}
      </div>
      <AnchoredTooltip
        anchor={tip && tipCard ? tip.anchor : null}
        placement="right"
        content={tipCard ? <HoverCard card={tipCard} bay={board.bayOf.get(tipCard.personaId)} /> : null}
      />
    </PersonaMenuProvider>
  );
});
