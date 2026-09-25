// Labels are a per-frame ALLOCATION, not a property of a node.
//
// Every caption the field wants is queued with a priority; the pass sorts by
// priority, lays each one out, and drops any that would overlap something
// already placed. What it dropped is COUNTED and printed, because the
// reference's rule is "the status line counts what it hides".
//
// Two properties make that count honest, and both were earned by looking at
// the rendered result rather than at the code:
//
//  1. A count of what the view WITHHELD is bounded by what the view could
//     have named. A candidate whose anchor lies outside the stage was never
//     something the reader could have read, so it is skipped and NOT counted:
//     counting it made a subject with six techniques and four visible names
//     claim twelve hidden labels, which is a lie in the direction that looks
//     like diligence.
//  2. The chrome is RESERVED before anything is placed. The HUD cards are
//     opaque, so a caption laid under one is not hidden by density, it is
//     hidden by furniture. Reserving their rects first makes labels move out
//     from under them instead of being painted behind them.
//
// The lens queues its own names at the top priority, which is how a lens
// caption displaces a field caption instead of overprinting it.
import { NUMBER_FONT_PX, placeFused, type Circle, type LabelWindow, type Side } from './labelsFused';
import type { CanvasTheme } from './theme';
import type { GalaxyNode, PickTarget } from './types';

export interface LabelRequest {
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
  weight: number;
  align: 'left' | 'center' | 'right';
  /**
   * Lower wins. 0 = the node the reader is standing on, 1 = the lens, the
   * council set, and the techniques of an open subject (at that altitude the
   * technique names ARE the content, so they yield only to the subject title).
   */
  priority: number;
  /**
   * The node this caption NAMES, when clicking the caption should climb out
   * of it. Only the title of the node the reader is standing on carries it,
   * and only once it has actually been placed does it become clickable -
   * which is why the pick is minted here and not by the painter.
   */
  climb?: GalaxyNode;
  /**
   * The fused profile only (`labelsFused.ts`): the node this caption names,
   * so the pass can try eight spots round it instead of one fixed box. The
   * classic pass never reads it.
   */
  anchor?: { x: number; y: number; off: number; side?: Side; centre?: boolean; maxW?: number };
  /** Fused only: the rank number that stands in when the name has no room. */
  rank?: number;
  /** Fused only: a second, smaller line under the name (a domain's counts). */
  caption?: { text: string; size: number; color: string; weight: number };
}

/** A placed or reserved box, in stage pixels. */
export interface Rect {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Nothing in this app renders below 13 px; the reference raised every one. */
export const MIN_LABEL_PX = 13;

function overlaps(rect: Rect, used: Rect[]): boolean {
  for (const u of used) {
    if (rect.a < u.c && rect.c > u.a && rect.b < u.d && rect.d > u.b) return true;
  }
  return false;
}

/** Is this candidate's box inside the stage at all? */
function inView(rect: Rect, width: number, bottom: number): boolean {
  return !(rect.c < -30 || rect.a > width + 30 || rect.d < -16 || rect.b > bottom + 16);
}

function boxOf(label: LabelRequest, textWidth: number): Rect {
  const h = label.size * 1.2;
  let x = label.x;
  if (label.align === 'center') x -= textWidth / 2;
  else if (label.align === 'right') x -= textWidth;
  return { a: x - 4, b: label.y - h * 0.8, c: x + textWidth + 4, d: label.y + h * 0.32 };
}

export class LabelQueue {
  private items: LabelRequest[] = [];

  private dropped = 0;

  private candidates = 0;

  reset(): void {
    this.items = [];
    this.dropped = 0;
    this.candidates = 0;
  }

  push(request: LabelRequest): void {
    this.items.push({ ...request, size: Math.max(MIN_LABEL_PX, request.size) });
  }

  /** Labels the view could have named this frame. */
  get candidateCount(): number {
    return this.candidates;
  }

  get droppedCount(): number {
    return this.dropped;
  }

  /**
   * Place what fits, count what the stage could have shown and did not.
   * `bottom` is the stage's live bottom edge (the bench eats into it);
   * `reserved` are the chrome rects, taken before any label is placed.
   */
  flush(
    ctx: CanvasRenderingContext2D,
    theme: CanvasTheme,
    width: number,
    bottom: number,
    reserved: Rect[] = [],
    picks?: PickTarget[],
  ): number {
    const used: Rect[] = reserved.slice();
    this.dropped = 0;
    this.candidates = 0;
    this.items.sort((a, b) => a.priority - b.priority);
    for (const label of this.items) {
      ctx.font = `${label.weight} ${label.size}px ${theme.font}`;
      const rect = boxOf(label, ctx.measureText(label.text).width);
      // Off-stage: never a candidate, so never a hidden label.
      if (!inView(rect, width, bottom)) continue;
      this.candidates += 1;
      if (overlaps(rect, used)) {
        this.dropped += 1;
        continue;
      }
      used.push(rect);
      if (label.climb && picks) {
        picks.push({
          x: (rect.a + rect.c) / 2,
          y: (rect.b + rect.d) / 2,
          r: 0,
          rect,
          node: label.climb,
          climb: true,
        });
      }
      // Painted twice: a halo in the sky colour so a caption stays legible
      // wherever it lands, then the ink itself.
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = theme.sky;
      ctx.globalAlpha = 0.82;
      ctx.textAlign = 'left';
      ctx.strokeText(label.text, rect.a + 4, label.y);
      ctx.globalAlpha = 1;
      ctx.fillStyle = label.color;
      ctx.fillText(label.text, rect.a + 4, label.y);
    }
    return this.dropped;
  }

  /**
   * The fused profile's pass (`labelsFused.ts`): eight spots per node, every
   * star an obstacle, two lines, then the rank number. Returns what it hid.
   */
  flushFused(
    ctx: CanvasRenderingContext2D,
    theme: CanvasTheme,
    width: number,
    bottom: number,
    reserved: Rect[],
    obstacles: Circle[],
    win: LabelWindow | null,
  ): number {
    const measure = (text: string, size: number, weight: number) => {
      ctx.font = `${weight} ${size}px ${theme.font}`;
      return ctx.measureText(text).width;
    };
    const out = placeFused(this.items, measure, width, bottom, reserved, obstacles, win);
    this.candidates = out.candidates;
    this.dropped = out.dropped;
    const ink = (text: string, x: number, y: number, size: number, weight: number, color: string, align: CanvasTextAlign) => {
      ctx.font = `${weight} ${size}px ${theme.font}`;
      ctx.textAlign = align;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 4;
      ctx.strokeStyle = theme.sky;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = color;
      ctx.fillText(text, x, y);
    };
    for (const { req, box, lines, numberOnly } of out.placed) {
      if (numberOnly) ink(String(req.rank), box.x + 3, box.y + 14, NUMBER_FONT_PX, 700, req.color, 'left');
      else if (req.caption) {
        ink(req.text, box.x + box.w / 2, box.y + 16, req.size, req.weight, req.color, 'center');
        ink(req.caption.text, box.x + box.w / 2, box.y + 34, req.caption.size, req.caption.weight, req.caption.color, 'center');
      } else if (lines) {
        ink(lines[0], box.x + 3, box.y + 14, req.size, req.weight, req.color, 'left');
        ink(lines[1], box.x + 3, box.y + 31, req.size, req.weight, req.color, 'left');
      } else ink(req.text, box.x + 3, box.y + 15, req.size, req.weight, req.color, 'left');
    }
    ctx.textAlign = 'left';
    return this.dropped;
  }
}

/**
 * The pure half of the pass, for tests: which requests survive, in order,
 * how many were candidates at all, and how many of those were hidden.
 * `measure` stands in for `ctx.measureText`.
 */
export function allocateLabels(
  requests: LabelRequest[],
  measure: (text: string, size: number, weight: number) => number,
  width: number,
  bottom: number,
  reserved: Rect[] = [],
): { placed: LabelRequest[]; dropped: number; candidates: number } {
  const placed: LabelRequest[] = [];
  const used: Rect[] = reserved.slice();
  let dropped = 0;
  let candidates = 0;
  for (const label of requests.slice().sort((a, b) => a.priority - b.priority)) {
    const size = Math.max(MIN_LABEL_PX, label.size);
    const sized = { ...label, size };
    const rect = boxOf(sized, measure(label.text, size, label.weight));
    if (!inView(rect, width, bottom)) continue;
    candidates += 1;
    if (overlaps(rect, used)) {
      dropped += 1;
      continue;
    }
    used.push(rect);
    placed.push(sized);
  }
  return { placed, dropped, candidates };
}
