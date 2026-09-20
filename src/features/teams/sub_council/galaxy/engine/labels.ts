// Labels are a per-frame ALLOCATION, not a property of a node.
//
// Every caption the field wants is queued with a priority; the pass sorts by
// priority, lays each one out, and drops any that would overlap a label
// already placed or fall outside the stage. What it dropped is COUNTED and
// printed — the reference's rule is "the status line counts what it hides",
// and a galaxy that silently swallows names is lying about its density.
//
// The lens queues its own names at the top priority, which is how a lens
// caption displaces a field caption instead of overprinting it.
import type { CanvasTheme } from './theme';

export interface LabelRequest {
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
  weight: number;
  align: 'left' | 'center' | 'right';
  /** Lower wins. 0 = the selected node, 1 = the lens and the council set. */
  priority: number;
}

interface Rect {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Nothing in this app renders below 13 px; the reference raised every one. */
export const MIN_LABEL_PX = 13;

export class LabelQueue {
  private items: LabelRequest[] = [];

  private dropped = 0;

  reset(): void {
    this.items = [];
    this.dropped = 0;
  }

  push(request: LabelRequest): void {
    this.items.push({ ...request, size: Math.max(MIN_LABEL_PX, request.size) });
  }

  get droppedCount(): number {
    return this.dropped;
  }

  /**
   * Place what fits, count what does not. Returns the number dropped.
   * `bottom` is the stage's live bottom edge (the bench eats into it).
   */
  flush(ctx: CanvasRenderingContext2D, theme: CanvasTheme, width: number, bottom: number): number {
    const placed: Rect[] = [];
    this.dropped = 0;
    this.items.sort((a, b) => a.priority - b.priority);
    for (const label of this.items) {
      ctx.font = `${label.weight} ${label.size}px ${theme.font}`;
      const w = ctx.measureText(label.text).width;
      const h = label.size * 1.2;
      let x = label.x;
      if (label.align === 'center') x -= w / 2;
      else if (label.align === 'right') x -= w;
      const rect: Rect = { a: x - 4, b: label.y - h * 0.8, c: x + w + 4, d: label.y + h * 0.32 };
      if (rect.c < -30 || rect.a > width + 30 || rect.d < -16 || rect.b > bottom + 16) {
        this.dropped += 1;
        continue;
      }
      let overlaps = false;
      for (const used of placed) {
        if (rect.a < used.c && rect.c > used.a && rect.b < used.d && rect.d > used.b) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) {
        this.dropped += 1;
        continue;
      }
      placed.push(rect);
      // Painted twice: a halo in the sky colour so a caption stays legible
      // wherever it lands, then the ink itself.
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = theme.sky;
      ctx.globalAlpha = 0.82;
      ctx.textAlign = 'left';
      ctx.strokeText(label.text, x, label.y);
      ctx.globalAlpha = 1;
      ctx.fillStyle = label.color;
      ctx.fillText(label.text, x, label.y);
    }
    return this.dropped;
  }
}

/**
 * The pure half of the pass, for tests: which requests survive, in order.
 * `measure` stands in for `ctx.measureText`.
 */
export function allocateLabels(
  requests: LabelRequest[],
  measure: (text: string, size: number, weight: number) => number,
  width: number,
  bottom: number,
): { placed: LabelRequest[]; dropped: number } {
  const placed: LabelRequest[] = [];
  const rects: Rect[] = [];
  let dropped = 0;
  for (const label of requests.slice().sort((a, b) => a.priority - b.priority)) {
    const size = Math.max(MIN_LABEL_PX, label.size);
    const w = measure(label.text, size, label.weight);
    const h = size * 1.2;
    let x = label.x;
    if (label.align === 'center') x -= w / 2;
    else if (label.align === 'right') x -= w;
    const rect: Rect = { a: x - 4, b: label.y - h * 0.8, c: x + w + 4, d: label.y + h * 0.32 };
    if (rect.c < -30 || rect.a > width + 30 || rect.d < -16 || rect.b > bottom + 16) {
      dropped += 1;
      continue;
    }
    if (rects.some((u) => rect.a < u.c && rect.c > u.a && rect.b < u.d && rect.d > u.b)) {
      dropped += 1;
      continue;
    }
    rects.push(rect);
    placed.push({ ...label, size });
  }
  return { placed, dropped };
}
