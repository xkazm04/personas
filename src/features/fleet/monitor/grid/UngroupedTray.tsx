// UngroupedTray — the teamless strip under the board, windowed above 30 tiles.
//
// The tray is where every persona with no team AND every live session the board
// could not place lands, so it is the part of this surface that grows fastest
// under a real fleet: measured on the load harness at 100 synthetic sessions,
// all 100 were tray tiles and all 100 were in the DOM at once.
//
// It was a `flex-wrap` box, which means the WRAP POINT was the browser's to
// decide. A windowed grid has to decide it itself, from the same two numbers
// CSS was using — tile width and gap — against a measured container width
// (`trayPerRow`). That is the only thing this component adds over the old
// markup, and it is why it needs a ResizeObserver: a wrap that recomputes on
// resize is what `flex-wrap` was already doing for free.
//
// Rows are UNIFORM height. Persona tiles are 38px and session tiles 30px, and
// the old markup centred them against each other with `items-center`; a
// uniform row of `TILE_H` with the tile centred inside reproduces that exactly
// while giving the virtualizer the fixed-height discipline it needs.
//
// Below `VIRTUALIZE_ABOVE` tiles the plain `flex-wrap` branch renders — byte
// for byte what the tray rendered before this change.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PersonaCardModel } from '../monitorModel';
import {
  TILE_W, TRAY_GAP, TRAY_ROW_H, VIRTUALIZE_ABOVE, trayPerRow,
} from './gridGeometry';

export interface UngroupedTrayProps {
  cards: PersonaCardModel[];
  sessions: FleetSession[];
  renderPersona: (card: PersonaCardModel) => ReactNode;
  renderSession: (session: FleetSession) => ReactNode;
}

export function UngroupedTray({
  cards, sessions, renderPersona, renderSession,
}: UngroupedTrayProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // The wrap point follows the container, exactly as `flex-wrap` did.
  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const total = cards.length + sessions.length;
  /** Personas first, then sessions — the order the tray already rendered in. */
  const tileAt = (i: number): ReactNode => {
    const card = cards[i];
    if (card) return renderPersona(card);
    const session = sessions[i - cards.length];
    return session ? renderSession(session) : null;
  };

  const perRow = trayPerRow(width);
  const rowCount = Math.ceil(total / perRow);
  const sizeOf = useCallback(() => TRAY_ROW_H, []);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: sizeOf,
    overscan: 3,
  });

  // `width === 0` is the first paint before the observer has measured: wrapping
  // by hand there would put every tile on one row. Fall back to the plain
  // branch until a real width exists, which is also what happens in jsdom.
  const virtualize = total > VIRTUALIZE_ABOVE && width > 0;

  if (!virtualize) {
    return (
      <div
        ref={parentRef}
        className="flex flex-wrap content-start items-center gap-1.5 overflow-auto pb-1"
      >
        {cards.map(renderPersona)}
        {sessions.map(renderSession)}
      </div>
    );
  }

  return (
    <div ref={parentRef} className="overflow-auto overscroll-contain pb-1">
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((v) => {
          const from = v.index * perRow;
          const slots = Array.from({ length: Math.min(perRow, total - from) }, (_, k) => from + k);
          return (
            <div
              key={v.index}
              className="absolute inset-x-0 top-0 flex items-center"
              style={{ height: v.size, gap: TRAY_GAP, transform: `translateY(${v.start}px)` }}
            >
              {slots.map((i) => (
                <div key={i} className="flex flex-shrink-0 items-center" style={{ width: TILE_W }}>
                  {tileAt(i)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default UngroupedTray;
