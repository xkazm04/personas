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
 * Node geometry. One width for EVERY node on the board — persona, live
 * session, queued session — so a column, the tray and the runway's wrapped
 * queue all measure with the same number and cannot drift. `NODE_W` is the
 * source; `TILE_W` / `QUEUE_TILE_W` are its names in the two places the board
 * grew up calling it something else.
 *
 * 172 wide, and TWO ROWS tall: a TITLE row (`typo-body`, the whole width, one
 * line, `TITLE_ROW_H`) over a SYMBOL row (`SYMBOL_ROW_H`, icon-sized
 * indicators, no text). The single-row tile at 152×38 could not hold a real
 * task title — it truncated the part that distinguished one session from the
 * next — and a first two-row node still shared the title row with a glyph, a
 * chip and side columns, leaving the title about 100 px. Now the title row is
 * the title alone and everything else is a symbol on the second row.
 */
export const NODE_W = 172;
export const TILE_W = NODE_W;
/** The title row: one `typo-body` line. */
export const TITLE_ROW_H = 20;
/** The symbol row: 16 px symbols with a hair of air. */
export const SYMBOL_ROW_H = 18;
/**
 * The room between the rows: a 1 px hairline divider and the air around it.
 * The body is `justify-between` — title pinned to the top, symbols to the
 * bottom — so this is what keeps the title from sitting on the symbol row
 * (the operator's 2026-09-21 note: "Task title sticks too close together").
 */
export const NODE_DIVIDER_H = 4;
/** Persona node: title row + divider room + symbol row + 4 px of padding above and below. */
export const TILE_H = TITLE_ROW_H + NODE_DIVIDER_H + SYMBOL_ROW_H + 8;
/** Sessions are visibly subordinate to the personas above them — same width,
 *  a little less height (3 px of padding, not 4). Not the same kind of citizen. */
export const SESSION_TILE_H = TITLE_ROW_H + NODE_DIVIDER_H + SYMBOL_ROW_H + 6;
/** The queue boards paint the same session node — one geometry, not a wider
 *  cousin (it was 232×30 before the node). */
export const QUEUE_TILE_W = NODE_W;
export const QUEUE_TILE_H = SESSION_TILE_H;

/** Vertical gap between tiles in a column (was `gap-1`). */
export const ROW_GAP = 4;
/** Gap between tiles in the wrapped tray (was `gap-1.5`). */
export const TRAY_GAP = 6;
/** Gap between columns, and between the board's rows of columns (`gap-3`). */
export const BOARD_GAP = 12;

/** Row heights = tile + its trailing gap. See the header for why the gap lives here. */
export const PERSONA_ROW_H = TILE_H + ROW_GAP;
export const SESSION_ROW_H = SESSION_TILE_H + ROW_GAP;
/**
 * The rule between a column's roster and its live sessions.
 *
 * It carried the words "Live Claude Sessions" until 2026-09-07 and is now a
 * hairline: the two tile kinds already differ in height, fill and border
 * treatment, so the label was naming a distinction the eye had already made —
 * once per column, twenty times over, on the board's scarcest axis. The word
 * survives for assistive tech, where the shape argument does not reach.
 */
export const DIVIDER_ROW_H = 12;
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

// ---------------------------------------------------------------------------
// The board's own wrap
//
// The board was ONE unbounded row of columns scrolling sideways, which put the
// twentieth project four screens to the right of the first and made "how is the
// fleet doing" a question you answered by dragging. It now wraps, so the fleet
// grows DOWN — the axis a display has more of, and the axis a scroll wheel is
// already on.
//
// Two consequences that had to be paid for rather than assumed:
//
//  • A column can no longer be `h-full`, because a row's height is now its
//    tallest column. Each column's body is content-sized and capped
//    (`COLUMN_BODY_MAX_H`), so one 200-persona team scrolls inside its own
//    column instead of making its row taller than the display.
//  • The wrap point is a COUNT, not a CSS `flex-wrap`. Flexbox can wrap on
//    width but cannot be told "at most five", and five is the number that keeps
//    a row readable as a unit. The width still matters when the board is too
//    narrow to hold five — hence `boardPerRow`, which takes the smaller of the
//    two, exactly as `trayPerRow` does one axis over.
// ---------------------------------------------------------------------------

/**
 * The OPTIMISTIC PRE-MEASUREMENT count: what the board assumes before its
 * scroller has been measured, and the ceiling `boardPerRow` keeps for every
 * caller that wants a count only. A first paint that opened at ten columns and
 * reflowed to five would be a worse opening than the brief overflow this
 * constant exists to prevent — `COLUMNS_PER_ROW_MAX` is the hard ceiling once
 * a real measurement exists.
 */
export const COLUMNS_PER_ROW = 5;

// ---------------------------------------------------------------------------
// The width ladder
//
// Five columns at the node's own 172px left the right edge of every display
// wider than a laptop unused — 650px on a 1920 window, 2170px on a 3440 one.
// The board now PACKS as many columns as fit at its measured width, caps the
// count, and spreads the remainder across them:
//
//   perRow      = clamp(floor((w + GAP) / (MIN + GAP)), 1, MAX_PER_ROW)
//   columnWidth = clamp((w - (perRow - 1) * GAP) / perRow, MIN, MAX)
//
// Three properties this has, and one it deliberately does not:
//
//  • A column is NEVER narrower than the node (`COLUMN_MIN_W`), so the ladder
//    can only improve on the fixed-width board it replaces. Below one node the
//    lower clamp holds the node's width and the board scrolls sideways, exactly
//    as it did before.
//  • The column narrows slightly each time a new column is admitted, then grows
//    again. That sawtooth is inherent to packing at a minimum width; it is
//    accepted, not a bug to smooth.
//  • Width comes from the row's CAPACITY, never from how many teams exist. A
//    three-team board shows three columns at the ladder width and leaves the
//    rest of the row empty rather than stretching three columns across an
//    ultra-wide display.
// ---------------------------------------------------------------------------

/**
 * A board column never narrows below the node it holds — this IS `NODE_W`,
 * named separately because it is the ladder's lower clamp rather than the
 * node's own geometry. Do not widen `NODE_W` to widen the board: `QUEUE_TILE_W`
 * aliases it, so that would silently widen the runway and lane queues too.
 */
export const COLUMN_MIN_W = NODE_W;
/**
 * …and never past this, so an ultra-wide board does not produce enormous tiles
 * with a title row swimming in empty space. Past it the slack stays at the
 * right edge, which is the honest place for it.
 */
export const COLUMN_MAX_W = 280;
/**
 * The hard ceiling on a measured row. Ten columns is where a row still reads as
 * one band on the widest display the app is used on; beyond it the eye is
 * scanning a field rather than a row.
 */
export const COLUMNS_PER_ROW_MAX = 10;

/**
 * A column's scrolling body is capped here so a row's height stays bounded by
 * the design rather than by whichever team has the most personas. Ten persona
 * rows: deep enough that the common case (a handful of agents) never scrolls,
 * shallow enough that five such columns still fit a laptop display.
 */
export const COLUMN_BODY_MAX_H = 10 * PERSONA_ROW_H;

/**
 * How many columns go on one board row at `width`: five, or fewer if narrow.
 * `tileWidth` defaults to the node width; the runway's wrapped queue measures
 * with the same node and no five-column ceiling (`maxPerRow`).
 */
export function boardPerRow(width: number, tileWidth = TILE_W, maxPerRow = COLUMNS_PER_ROW): number {
  // Before the first measurement, assume the full count — a one-column first
  // paint that reflows to five is a worse opening than a brief overflow.
  if (width <= 0) return maxPerRow;
  const fit = Math.floor((width + BOARD_GAP) / (tileWidth + BOARD_GAP));
  return Math.max(1, Math.min(maxPerRow, fit));
}

/** What a measured board row is: how many columns, and how wide each one is. */
export interface BoardLayout {
  perRow: number;
  columnWidth: number;
}

/**
 * The classic board's row layout at `width` — the ladder described above.
 *
 * Unlike `boardPerRow`, which every caller that wants a count only keeps using
 * unchanged, this decides a WIDTH as well, and it is the only place that may:
 * the column width is a runtime value now, not a constant, because it depends
 * on a measurement the module cannot make.
 */
export function boardLayout(width: number): BoardLayout {
  // Unmeasured: the optimistic count at the node's own width. The ghost paints
  // from the same pair, so the first real measurement widens the board rather
  // than reflowing it.
  if (width <= 0) return { perRow: COLUMNS_PER_ROW, columnWidth: COLUMN_MIN_W };
  const perRow = boardPerRow(width, COLUMN_MIN_W, COLUMNS_PER_ROW_MAX);
  const spread = Math.floor((width - (perRow - 1) * BOARD_GAP) / perRow);
  return { perRow, columnWidth: Math.min(COLUMN_MAX_W, Math.max(COLUMN_MIN_W, spread)) };
}

/** Split an ordered column list into rows of at most `perRow`. */
export function chunkRows<T>(items: readonly T[], perRow: number): T[][] {
  const size = Math.max(1, perRow);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** One addressable row of a team column, with its height already decided. */
export type ColumnRow =
  | { kind: 'persona'; key: string; height: number; card: PersonaCardModel; teamName: string | null }
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
  /** The column's team, which the persona node's meta row names. */
  teamName: string | null = null,
): ColumnRow[] {
  const rows: ColumnRow[] = cards.map((card) => ({
    kind: 'persona' as const,
    key: `p:${card.personaId}`,
    height: PERSONA_ROW_H,
    card,
    teamName,
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
 *
 * `tileWidth` defaults to the node width and the tray's caller keeps the
 * default — the parameter exists so this cannot drift from `boardPerRow`, which
 * has taken one since the queue boards started measuring with their own tile.
 * An asymmetry where one of two twin functions closes over a constant is the
 * shape that bites the day that constant stops being one.
 */
export function trayPerRow(width: number, tileWidth = TILE_W): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.floor((width + TRAY_GAP) / (tileWidth + TRAY_GAP)));
}
