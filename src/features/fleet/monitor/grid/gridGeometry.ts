// gridGeometry — the Activity board's tile arithmetic, in one place.
//
// The board is a TWO-AXIS surface: columns run horizontally, tiles stack
// vertically inside a column, and a wrapped tray sits underneath. Virtualizing
// any of those axes means the renderer has to know a row's height BEFORE it
// paints the row — the same fixed-height discipline `rail/RailList` runs on,
// and the same one `DeckQueueRail` learned the hard way when an `estimateSize`
// and a padding-implied height drifted and misplaced every row past the 40th.
//
// So every height on this board is a constant here, and the gap between rows is
// FOLDED INTO the row height rather than expressed as a flex `gap`. A
// virtualized row is absolutely positioned at a computed offset; a CSS gap the
// virtualizer cannot see would put the tile and the offset in different places.
// One number per row kind, used by both the plain and the virtualized branch,
// is the only shape in which those two cannot disagree.

import type { FleetSession } from '@/lib/bindings/FleetSession';
import type { PersonaCardModel } from '../monitorModel';

/**
 * Tile geometry. The width is 4× the 38px square this board used to paint, at
 * exactly the same height — the change that put persona names on the board
 * instead of two-letter initials. Constants rather than classes because the
 * column width is derived from the tile width, so the two cannot drift.
 */
export const TILE_W = 152;
export const TILE_H = 38;
/** Sessions are visibly subordinate to the personas above them — same column
 *  width, less height. Not the same kind of citizen. */
export const SESSION_TILE_H = 30;

/** Vertical gap between tiles in a column (was `gap-1`). */
export const ROW_GAP = 4;
/** Gap between tiles in the wrapped tray (was `gap-1.5`). */
export const TRAY_GAP = 6;

/** Row heights = tile + its trailing gap. See the header for why the gap lives here. */
export const PERSONA_ROW_H = TILE_H + ROW_GAP;
export const SESSION_ROW_H = SESSION_TILE_H + ROW_GAP;
/** The "Sessions" divider: caption line + its own leading margin. */
export const DIVIDER_ROW_H = 24;
/** Tray rows are uniform: a session tile is shorter and rides centred, exactly
 *  as it did under the old `flex-wrap items-center`. */
export const TRAY_ROW_H = TILE_H + TRAY_GAP;

/**
 * Below this many rows, plain DOM beats a measure pass — the same threshold and
 * the same reasoning as `rail/RailList`. A team with six personas must render
 * byte-for-byte what it rendered before this change; virtualization is a
 * scale valve, not a new baseline.
 */
export const VIRTUALIZE_ABOVE = 30;

/** One addressable row of a team column, with its height already decided. */
export type ColumnRow =
  | { kind: 'persona'; key: string; height: number; card: PersonaCardModel }
  | { kind: 'divider'; key: string; height: number }
  | { kind: 'session'; key: string; height: number; session: FleetSession };

/**
 * Flatten a column into its rows: the roster, then — only if the column has
 * live sessions — a divider and the session tiles.
 *
 * The divider is a ROW rather than a wrapper because the alternative is two
 * lists with two virtualizers sharing one scroller, and that is exactly the
 * offset arithmetic this module exists to avoid. Rendering nothing when there
 * are no sessions is preserved: an empty divider would read as "this team has a
 * session lane and it is empty", which is a different claim.
 */
export function columnRows(
  cards: PersonaCardModel[],
  sessions: readonly FleetSession[],
): ColumnRow[] {
  const rows: ColumnRow[] = cards.map((card) => ({
    kind: 'persona' as const,
    key: `p:${card.personaId}`,
    height: PERSONA_ROW_H,
    card,
  }));
  if (sessions.length === 0) return rows;
  rows.push({ kind: 'divider', key: 'divider', height: DIVIDER_ROW_H });
  for (const session of sessions) {
    rows.push({ kind: 'session', key: `s:${session.id}`, height: SESSION_ROW_H, session });
  }
  return rows;
}

/**
 * How many tray tiles fit on one wrapped row at `width`. The tray was a
 * `flex-wrap` box, so the wrap point was the browser's to decide; a virtualized
 * grid has to decide it itself, from the same numbers CSS was using.
 */
export function trayPerRow(width: number): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.floor((width + TRAY_GAP) / (TILE_W + TRAY_GAP)));
}
