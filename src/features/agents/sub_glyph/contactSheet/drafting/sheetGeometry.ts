/** Pure geometry and ink rules for the Drafting Sheet. No React.
 *
 *  A sheet's drawing is laid out the same way at every depth: a row of parts
 *  along the top, a row along the bottom, and the figure in the band between
 *  them, with a leader line from each part to the feature it names. Sheet 1
 *  draws the persona (eight dimension regions around the sigil); a nested
 *  sheet draws one dimension (its parts around the dimension's emblem). */
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS, PETAL_ANGLES } from "@/features/shared/glyph";
import type { FrameState } from "../cinema/sheetModel";

/** A part's ink: dashed outline, hatched under the pen, asked about, inked with a tick, or failed. */
export type Ink = "pending" | "drafting" | "asking" | "done" | "error";

/** Clockwise from the top-left corner: each region sits on the side its petal
 *  points to, so no two leader lines cross. */
export const TOP_ROW: readonly GlyphDimension[] = ["error", "trigger", "task", "connector"];
export const BOTTOM_ROW: readonly GlyphDimension[] = ["event", "memory", "review", "message"];

/** 1..8, the drawing's caption numbers, in petal order. */
export const dimNumber = (dim: GlyphDimension) => GLYPH_DIMENSIONS.indexOf(dim) + 1;

/** Sheet 1 is the persona; each dimension has its own sheet after it. */
export const SHEET_TOTAL = GLYPH_DIMENSIONS.length + 1;

/** A frame state plus whether its ink step has been drawn yet. A populated
 *  region waits for its beat (`inked`) before it turns solid. */
export function inkOf(state: FrameState, inked: boolean): Ink {
  if (state === "error") return "error";
  if (state === "pending") return "asking";
  if (state === "filling") return "drafting";
  return inked ? "done" : "pending";
}

export interface Box { x: number; y: number; w: number; h: number }
export interface Pt { x: number; y: number }

export interface DrawingGeometry {
  top: Box[];
  bottom: Box[];
  /** The figure's centre and diameter. */
  figure: { cx: number; cy: number; size: number };
  /** The strip under the figure (the casting roll, the crowned name). */
  strip: Box;
  /** The band between the rows (the compose surface sits here). */
  band: Box;
}

const GAP = 12;
const LEAD = 22;

function row(n: number, y: number, w: number, h: number): Box[] {
  if (n <= 0) return [];
  const bw = (w - GAP * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ x: i * (bw + GAP), y, w: bw, h }));
}

/** Two rows of parts and the figure between them, in a `w` x `h` drawing. */
export function drawingGeometry(w: number, h: number, topN: number, bottomN: number, stripH: number): DrawingGeometry {
  const rh = Math.round(Math.min(88, Math.max(58, h * 0.14)));
  const topH = topN > 0 ? rh : 0;
  const bottomH = bottomN > 0 ? rh : 0;
  const band = { x: 0, y: topH + (topN > 0 ? LEAD : 0), w, h: 0 };
  band.h = Math.max(0, h - band.y - bottomH - (bottomN > 0 ? LEAD : 0));
  const strip = { x: 0, y: band.y + band.h - stripH, w, h: stripH };
  const size = Math.max(0, Math.min(band.h - stripH, w * 0.62));
  return {
    top: row(topN, 0, w, topH),
    bottom: row(bottomN, h - bottomH, w, bottomH),
    figure: { cx: w / 2, cy: band.y + (band.h - stripH) / 2, size },
    strip,
    band,
  };
}

/** Where a part's leader line leaves it: the edge facing the figure. */
export const anchorOf = (b: Box, onTop: boolean): Pt => ({ x: b.x + b.w / 2, y: onTop ? b.y + b.h : b.y });

/** The tip of a dimension's petal, for a sigil drawn at `fig`. */
export function petalTip(dim: GlyphDimension, fig: DrawingGeometry["figure"]): Pt {
  const a = (PETAL_ANGLES[dim] * Math.PI) / 180;
  const r = fig.size * 0.44;
  return { x: fig.cx + Math.sin(a) * r, y: fig.cy - Math.cos(a) * r };
}

/** The point on a circle of radius `r` about the figure that faces `p`. */
export function towards(fig: DrawingGeometry["figure"], p: Pt, r: number): Pt {
  const dx = p.x - fig.cx;
  const dy = p.y - fig.cy;
  const d = Math.hypot(dx, dy) || 1;
  return { x: fig.cx + (dx / d) * r, y: fig.cy + (dy / d) * r };
}

/** The sigil's petal outline (SheetSigil's curve), pointing up from the centre. */
export function petalPath(size: number): string {
  const outer = size * 0.44;
  const inner = size * 0.13;
  const w = size * 0.065;
  return `M 0 -${inner} C ${w} -${outer * 0.49}, ${w} -${outer * 0.77}, 0 -${outer} C -${w} -${outer * 0.77}, -${w} -${outer * 0.49}, 0 -${inner} Z`;
}
