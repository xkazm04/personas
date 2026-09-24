// Pin geometry for a variant preview.
//
// The preview is an iframe laid out at a DESIGN viewport (1280x800 or
// 1920x1080 — the visual pass's widths) and scaled down to fit its box. A pin
// is stored in DOCUMENT coordinates, as a percent of the page's full size, so
// it stays on the thing it points at however far the page is scrolled. The
// page reports its scroll and size through the preview route's injected
// reporter (`contest-preview-scroll`); a variant that blocks it gets pins in
// viewport coordinates instead, which REVIEW.md states.
//
// Pure, so the math is tested without a DOM.
import type { ContestPin } from '@/lib/bindings/ContestPin';

export type DesignWidth = 1280 | 1920;

export const DESIGN_WIDTHS: readonly DesignWidth[] = [1280, 1920];

/** The viewport height paired with each design width (visual-pass widths). */
export const DESIGN_HEIGHT: Readonly<Record<DesignWidth, number>> = { 1280: 800, 1920: 1080 };

/** The message type the preview route's injected reporter posts. */
export const PREVIEW_SCROLL_MESSAGE = 'contest-preview-scroll';

/** What the page reported about itself, in its own CSS pixels. */
export interface PreviewScroll {
  scrollX: number;
  scrollY: number;
  docW: number;
  docH: number;
}

/** A pin's position inside the frame's box, in the box's CSS pixels. */
export interface PinPoint {
  x: number;
  y: number;
}

/** Scale that fits the design viewport into `boxWidth` (never enlarges). */
export function fitScale(boxWidth: number, designWidth: DesignWidth): number {
  if (!(boxWidth > 0)) return 0;
  return Math.min(1, boxWidth / designWidth);
}

/** Parse a `message` event's data as a scroll report; null when it is not one. */
export function readScrollReport(data: unknown): PreviewScroll | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.type !== PREVIEW_SCROLL_MESSAGE) return null;
  const nums = [d.scrollX, d.scrollY, d.docW, d.docH];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [scrollX, scrollY, docW, docH] = nums as number[];
  if (docW! <= 0 || docH! <= 0) return null;
  return { scrollX: scrollX!, scrollY: scrollY!, docW: docW!, docH: docH! };
}

/**
 * A click on the scaled overlay → a pin. `boxX`/`boxY` are the click's offset
 * inside the overlay, in CSS pixels of the SCALED box.
 */
export function pinFromClick(
  boxX: number,
  boxY: number,
  scale: number,
  width: DesignWidth,
  scroll: PreviewScroll | null,
  note = '',
): ContestPin {
  const height = DESIGN_HEIGHT[width];
  const s = scale > 0 ? scale : 1;
  const vx = clamp(boxX / s, 0, width);
  const vy = clamp(boxY / s, 0, height);
  const docW = scroll ? scroll.docW : width;
  const docH = scroll ? scroll.docH : height;
  const dx = scroll ? vx + scroll.scrollX : vx;
  const dy = scroll ? vy + scroll.scrollY : vy;
  return {
    xPct: round1(clamp((dx / docW) * 100, 0, 100)),
    yPct: round1(clamp((dy / docH) * 100, 0, 100)),
    width,
    height,
    note,
  };
}

/**
 * Where an existing pin sits in the scaled box, or null when it is outside
 * the visible scroll window (or the page's size is unknown for a pin that was
 * placed against a different viewport).
 */
export function pinToPoint(
  pin: Pick<ContestPin, 'xPct' | 'yPct'>,
  scale: number,
  width: DesignWidth,
  scroll: PreviewScroll | null,
): PinPoint | null {
  const height = DESIGN_HEIGHT[width];
  const docW = scroll ? scroll.docW : width;
  const docH = scroll ? scroll.docH : height;
  const vx = (pin.xPct / 100) * docW - (scroll ? scroll.scrollX : 0);
  const vy = (pin.yPct / 100) * docH - (scroll ? scroll.scrollY : 0);
  if (vx < 0 || vy < 0 || vx > width || vy > height) return null;
  return { x: vx * scale, y: vy * scale };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** One decimal, matching REVIEW.md's `pin at (x%, y%)` precision. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
