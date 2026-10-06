/** What the annotated sheet writes in its margins, and where. Pure.
 *
 *  A frame's notes are facts the build has CONFIRMED about its dimension (the
 *  frame value, never the streaming preview) plus, once the draft's rows
 *  exist, how many capabilities use it. A frame with nothing confirmed gets
 *  no note: the sheet never draws a part it has nothing for. Notes are keyed
 *  by kind, so a fact that changes is rewritten in place rather than drawn
 *  again as a new step. */
import type { GlyphDimension, GlyphRow } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { FrameState } from "../cinema/sheetModel";
import type { FrameValue } from "../cinema/useFrameValues";
import type { Box, SheetGeometry } from "./sheetGeometry";
import { COPY } from "./copy";

export interface Note { id: string; kind: string; text: string }

const list = (xs: string[], keep = 2) =>
  xs.slice(0, keep).join(", ") + (xs.length > keep ? ` ${COPY.more(xs.length - keep)}` : "");

/** At most two notes per frame: the fact, then its coverage. */
export function notesFor(dim: GlyphDimension, v: FrameValue | null, rows: readonly GlyphRow[]): Note[] {
  const out: Note[] = [];
  const add = (key: string, kind: string, text: string | undefined) => {
    const t = text?.trim();
    if (t) out.push({ id: `note:${dim}:${key}`, kind, text: t });
  };
  if (v) {
    switch (dim) {
      case "trigger": add("fact", v.week || v.triggerKind === "schedule" ? COPY.kind.cadence : COPY.kind.trigger, v.caption); break;
      case "task": add("fact", v.by === "you" && !v.caps?.length ? COPY.kind.brief : COPY.kind.caps, v.caps?.length ? list(v.caps) : v.caption); break;
      case "connector": add("fact", COPY.kind.apps, list(v.lines.length ? v.lines : [v.caption], 3)); break;
      case "message": add("fact", COPY.kind.channel, list(v.channels ?? [v.caption], 3)); break;
      case "event": add("fact", COPY.kind.listens, list(v.events ?? [v.caption])); break;
      case "review": add("fact", COPY.kind.review, v.caption); break;
      case "memory": add("fact", COPY.kind.memory, v.caption); break;
      case "error": add("fact", COPY.kind.onError, v.caption); break;
    }
  }
  if (rows.length) {
    const used = rows.filter((r) => r.presence[dim] !== "none").length;
    if (used > 0) add("cover", COPY.kind.usedBy, COPY.usedBy(used, rows.length));
  }
  return out;
}

/** How a frame is inked right now.
 *  pending  dashed ghost: nothing known yet;
 *  drafting hatched under the pen: data is arriving, or it has arrived and
 *           the pen has not reached it in the build-up yet;
 *  needs    hatched in the frame's colour: a question is open on it;
 *  inked    solid, in the frame's colour, with a tick;
 *  unused   settled empty: dashed, fainter;
 *  error    the build could not resolve it. */
export type Ink = "pending" | "drafting" | "needs" | "inked" | "unused" | "error";

export function inkOf(state: FrameState, populated: boolean, drawn: boolean): Ink {
  if (state === "error") return "error";
  if (state === "pending") return "needs";
  if (state === "filling") return "drafting";
  if (populated) return drawn ? "inked" : "drafting";
  return state === "unset" || state === "lit" ? "unused" : "pending";
}

// ---------------------------------------------------------------------------
// Margin layout
// ---------------------------------------------------------------------------

/** Which margin a frame's notes go to. The two middle-column frames have no
 *  margin of their own: their leader runs along the band above (When) or
 *  below (Review) the sheet into the nearer side margin. */
const SIDE: Record<GlyphDimension, { side: "left" | "right"; elbow: "top" | "bottom" | null }> = {
  error: { side: "left", elbow: null },
  event: { side: "left", elbow: null },
  memory: { side: "left", elbow: null },
  review: { side: "left", elbow: "bottom" },
  trigger: { side: "right", elbow: "top" },
  task: { side: "right", elbow: null },
  connector: { side: "right", elbow: null },
  message: { side: "right", elbow: null },
};

/** One note row: the lettered kind over its fact. */
export const NOTE_H = 34;
const BLOCK_GAP = 10;
/** Clearance between a block and the sheet edge, and the leader's shoulder. */
const CLEAR = 28;
const SHOULDER = 12;
const LANE = 10;

export interface PlacedBlock {
  dim: GlyphDimension;
  side: "left" | "right";
  x: number;
  y: number;
  w: number;
  h: number;
  /** The leader, from the frame (its first point) to the block. */
  leader: string;
  /** Where the leader touches the frame. */
  dot: { x: number; y: number };
}

function stack(items: { dim: GlyphDimension; want: number; h: number }[], top: number, bottom: number) {
  const sorted = [...items].sort((a, b) => a.want - b.want);
  const ys: number[] = [];
  let next = top;
  for (const it of sorted) { const y = Math.max(it.want, next); ys.push(y); next = y + it.h + BLOCK_GAP; }
  // Overflowing the bottom: push the stack back up from the end.
  let limit = bottom;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const it = sorted[i]!;
    if (ys[i]! + it.h > limit) ys[i] = Math.max(top, limit - it.h);
    limit = ys[i]! - BLOCK_GAP;
  }
  return sorted.map((it, i) => ({ ...it, y: ys[i]! }));
}

function leaderFor(cell: Box, side: "left" | "right", elbow: "top" | "bottom" | null, g: SheetGeometry, blockX: number, blockW: number, by: number) {
  const s = g.sheet;
  const end = side === "left" ? blockX + blockW + 4 : blockX - 4;
  const shoulder = side === "left" ? s.x - SHOULDER : s.x + s.w + SHOULDER;
  const ly = by + 9;
  if (elbow === "top") {
    const fx = cell.x + cell.w * 0.78;
    return { d: `M${fx} ${cell.y} V${s.y - LANE} H${shoulder} V${ly} H${end}`, dot: { x: fx, y: cell.y } };
  }
  if (elbow === "bottom") {
    const fx = cell.x + cell.w * 0.22;
    const fy = cell.y + cell.h;
    return { d: `M${fx} ${fy} V${s.y + s.h + LANE} H${shoulder} V${ly} H${end}`, dot: { x: fx, y: fy } };
  }
  const fx = side === "left" ? cell.x : cell.x + cell.w;
  const fy = Math.min(cell.y + cell.h - 10, Math.max(cell.y + 10, ly));
  return { d: `M${fx} ${fy} L${shoulder} ${ly} H${end}`, dot: { x: fx, y: fy } };
}

/** Place every frame's notes in the margins: each block wants to sit level
 *  with its frame and is pushed down (then up) until none overlap. All notes
 *  count toward a block's height, drawn or not, so a block never moves while
 *  it is being written (the spacer trick, in the margin). */
export function placeBlocks(g: SheetGeometry, notes: Record<GlyphDimension, Note[]>): PlacedBlock[] {
  if (!g.annotate) return [];
  const s = g.sheet;
  const out: PlacedBlock[] = [];
  for (const side of ["left", "right"] as const) {
    const items = GLYPH_DIMENSIONS.filter((d) => SIDE[d].side === side && notes[d].length > 0).map((dim) => {
      const c = g.cells[dim];
      const h = notes[dim].length * NOTE_H;
      const elbow = SIDE[dim].elbow;
      const want = elbow === "top" ? s.y : elbow === "bottom" ? s.y + s.h - h : c.y + Math.max(0, (Math.min(c.h, 140) - h) / 2);
      return { dim, want, h };
    });
    const w = Math.max(60, g.margin - CLEAR - 10);
    const x = side === "left" ? 10 : s.x + s.w + CLEAR;
    for (const b of stack(items, s.y, s.y + s.h)) {
      const { d, dot } = leaderFor(g.cells[b.dim], side, SIDE[b.dim].elbow, g, x, w, b.y);
      out.push({ dim: b.dim, side, x, y: b.y, w, h: b.h, leader: d, dot });
    }
  }
  return out;
}
