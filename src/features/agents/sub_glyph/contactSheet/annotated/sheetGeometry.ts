/** Where everything sits on the annotated sheet, in stage pixels. Pure: the
 *  Cinema 3x3 is kept (frames where their sigil petal points, the centre cell
 *  in the middle), but it is drawn INSIDE a margin, because a drawing is
 *  annotated in its margins. The cells are computed exactly the way the CSS
 *  grid lays them out (minmax(0, fr) tracks, a fixed gap), so the leader lines
 *  can start at a frame's edge without measuring the DOM. */
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import { FRAME_CELL } from "../cinema/sheetModel";

export interface Box { x: number; y: number; w: number; h: number }

export const GAP = 12;
/** Column and row weights: the centre column a touch wider than Cinema's 1.5
 *  so the composer keeps its width once the side margins take their share. */
export const COLS = [1, 1.6, 1] as const;
export const ROWS = [1, 2.3, 1] as const;
/** The bands above and below the sheet: a leader lane and a dimension line. */
export const BAND = 40;
/** Under this the margins are dropped and nothing is annotated in them. */
const MIN_ANNOTATED = { w: 900, h: 440 };
const EDGE = 8;

export interface SheetGeometry {
  /** Margins are wide enough to annotate in. */
  annotate: boolean;
  /** Width of each side margin. */
  margin: number;
  sheet: Box;
  cells: Record<GlyphDimension, Box>;
  centre: Box;
  /** x of each column's left edge and its width (for the chain dimension). */
  cols: { x: number; w: number }[];
}

function tracks(start: number, length: number, weights: readonly number[]): { at: number; len: number }[] {
  const free = Math.max(0, length - GAP * (weights.length - 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  let at = start;
  return weights.map((w) => {
    const len = (free * w) / sum;
    const t = { at, len };
    at += len + GAP;
    return t;
  });
}

export function sheetGeometry(stage: { w: number; h: number }): SheetGeometry {
  const annotate = stage.w >= MIN_ANNOTATED.w && stage.h >= MIN_ANNOTATED.h;
  const margin = annotate ? Math.round(Math.min(220, Math.max(124, stage.w * 0.12))) : EDGE;
  const band = annotate ? BAND : EDGE;
  const sheet: Box = { x: margin, y: band, w: Math.max(0, stage.w - 2 * margin), h: Math.max(0, stage.h - 2 * band) };
  const cx = tracks(sheet.x, sheet.w, COLS);
  const cy = tracks(sheet.y, sheet.h, ROWS);
  const cell = (col: number, row: number): Box => ({ x: cx[col - 1]!.at, y: cy[row - 1]!.at, w: cx[col - 1]!.len, h: cy[row - 1]!.len });
  const cells = {} as Record<GlyphDimension, Box>;
  for (const dim of GLYPH_DIMENSIONS) cells[dim] = cell(FRAME_CELL[dim][0], FRAME_CELL[dim][1]);
  return { annotate, margin, sheet, cells, centre: cell(2, 2), cols: cx.map((t) => ({ x: t.at, w: t.len })) };
}

/** CSS grid templates matching the tracks above (and Cinema's premiere strip). */
export const GRID_COLS = COLS.map((w) => `minmax(0, ${w}fr)`).join(" ");
export const GRID_ROWS = ROWS.map((w) => `minmax(0, ${w}fr)`).join(" ");
