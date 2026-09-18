// BoardGhost — the Activity board's calm, geometry-matched loading ghost.
//
// Two callers, one shape. On a COLD open (no roster yet) it stands in for the
// whole board: a few columns of tile-shaped bars under the permanent header,
// instead of the settled empty state — "all clear" before the first read lands
// is the empty-flash lie (loading v2, laws 1 and 3). During the STAGED first
// paint it stands in for one column's rows while the real tiles wait a frame.
//
// Every bar is drawn from `gridGeometry`'s constants, so the swap to real
// tiles moves nothing. Static — never `animate-pulse` (law 3). Delayed 150ms
// through the shared `animate-fade-in` treatment so a warm swap that takes two
// frames never paints it at all.

import { PERSONA_ROW_H, SYMBOL_ROW_H, TILE_H, TILE_W, TITLE_ROW_H } from './gridGeometry';

/** Ghost rows per column — enough to read as a roster, few enough to stay calm. */
const COLD_COLUMNS = 3;
const COLD_ROWS = 6;
export const GHOST_ROW_CAP = 12;
/** Symbol-shaped dots on the ghost's second row — the node's row is a run of 16 px marks. */
const GHOST_SYMBOLS = 3;

/** One node-shaped box: a title bar over a row of symbol-sized dots. */
function GhostRow() {
  return (
    <div style={{ height: PERSONA_ROW_H }}>
      <div
        className="relative flex flex-col justify-center overflow-hidden rounded-input border border-border bg-foreground/[0.02] px-1"
        style={{ width: TILE_W, height: TILE_H }}
      >
        <span className="flex items-center" style={{ height: TITLE_ROW_H }}>
          <span className="h-[0.6em] w-24 rounded bg-primary/[0.06] typo-body" />
        </span>
        <span className="flex items-center gap-1" style={{ height: SYMBOL_ROW_H }}>
          {Array.from({ length: GHOST_SYMBOLS }, (_, i) => (
            <span key={i} className="h-3 w-3 rounded-full bg-primary/[0.05]" />
          ))}
        </span>
      </div>
    </div>
  );
}

/**
 * The rows of one column, for the staged first paint.
 *
 * `maxHeight` mirrors `ColumnBody`'s: since the board wraps into rows the
 * column is content-sized rather than `h-full`, and a ghost that sized itself
 * differently from the body it stands in for would move the board on the swap
 * — which is the one thing a geometry-matched ghost exists not to do.
 */
export function ColumnGhost({ rows, maxHeight }: { rows: number; maxHeight?: number }) {
  const n = Math.max(1, Math.min(GHOST_ROW_CAP, rows));
  return (
    <div
      aria-hidden
      className={`min-h-0 overflow-hidden animate-fade-in ${maxHeight === undefined ? 'flex-1' : ''}`}
      style={{ animationDelay: '150ms', maxHeight }}
      data-testid="fleet-grid-column-ghost"
    >
      {Array.from({ length: n }, (_, i) => <GhostRow key={i} />)}
    </div>
  );
}

/** The whole board, for the cold open: headers ghosted too. */
export function BoardGhost() {
  return (
    <div
      aria-hidden
      className="min-h-0 flex-1 overflow-hidden p-3 animate-fade-in"
      style={{ animationDelay: '150ms' }}
      data-testid="fleet-grid-board-ghost"
    >
      <div className="flex h-full gap-3">
        {Array.from({ length: COLD_COLUMNS }, (_, c) => (
          <section key={c} className="flex h-full min-h-0 flex-shrink-0 flex-col gap-1.5" style={{ width: TILE_W }}>
            <div className="flex flex-shrink-0 flex-col gap-1 pb-2 pt-0.5">
              <div className="flex items-baseline gap-1.5 px-1 py-0.5 typo-label">
                <span className="h-[0.7em] w-24 rounded bg-primary/[0.06]" />
              </div>
              <span aria-hidden className="h-0.5 w-full rounded-full bg-foreground/10" />
            </div>
            {Array.from({ length: COLD_ROWS }, (_, i) => <GhostRow key={i} />)}
          </section>
        ))}
      </div>
    </div>
  );
}

export default BoardGhost;
