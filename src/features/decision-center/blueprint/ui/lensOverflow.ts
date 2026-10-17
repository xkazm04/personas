/** Which lens tabs the strip cuts off, and how far to scroll to bring the nearest one in. Pure: boxes in, numbers out. */
export interface Span { left: number; right: number }
export interface Overflow {
  /** Tabs cut off at the left edge and at the right edge (a tab only partly in view counts as cut off). */
  before: number;
  after: number;
  /** The scroll that brings the nearest cut-off tab fully into view, per side (0 when none is cut off). */
  toBefore: number;
  toAfter: number;
}

const EPS = 1;

export function overflowOf(strip: Span, tabs: readonly Span[]): Overflow {
  let before = 0, after = 0, toBefore = 0, toAfter = 0;
  for (const t of tabs) {
    if (t.left < strip.left - EPS) { before++; toBefore = Math.min(toBefore, t.left - strip.left); }
    if (t.right > strip.right + EPS) { after++; if (after === 1) toAfter = t.right - strip.right; }
  }
  return { before, after, toBefore, toAfter };
}
