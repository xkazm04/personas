/**
 * Radial (spark twin-portable-blueprint, WP10): where things go on the
 * measured canvas. L1 sizes the ring so its four labels keep full type size in
 * the corners; the zoom lands on the L2 ring's centre; the stage keeps the
 * ring in the rail left of the centred question card. Pure.
 */
import { SECTION_IDS, type SectionId } from '../../blueprintContract';
import { type Pt, RING, polar, segmentAngles } from './radialGeometry';

const f = (n: number) => Math.round(n * 100) / 100;

export type LabelH = 'left' | 'right';
export type LabelV = 'top' | 'bottom';

export interface LabelBox {
  /** The corner of the label nearest the ring (the leader's end). */
  x: number;
  y: number;
  h: LabelH;
  v: LabelV;
  /** Room from the corner to the canvas edge. */
  maxW: number;
}

export interface OverviewLayout {
  w: number;
  h: number;
  cx: number;
  cy: number;
  R: number;
  labels: Record<SectionId, LabelBox>;
  /** Where the "pick a segment" hint sits, when there is room under the ring. */
  hintY: number | null;
}

const PAD = 16;
const LABEL_GAP = 18;
/** Room a label needs beyond its corner: name + figure on one line, two stats under it. */
const LABEL_W = 232;
const LABEL_H = 84;
const R_MAX = 430;
const R_MIN = 90;
const SIDES: Record<SectionId, { h: LabelH; v: LabelV }> = {
  identity: { h: 'right', v: 'top' },
  voice: { h: 'right', v: 'bottom' },
  knowledge: { h: 'left', v: 'bottom' },
  training: { h: 'left', v: 'top' },
};

/**
 * L1: the largest ring whose four diagonal labels still fit between the ring
 * and the canvas corners at full type size. The labels never shrink; the ring
 * does.
 */
export function overviewLayout(w: number, h: number): OverviewLayout {
  const k = Math.SQRT1_2;
  const byW = (w / 2 - PAD - LABEL_W) / k - LABEL_GAP;
  const byH = (h / 2 - PAD - LABEL_H) / k - LABEL_GAP;
  const fit = Math.min(h / 2 - PAD * 2, w / 2 - PAD);
  const R = Math.max(R_MIN, Math.min(byW, byH, fit, R_MAX));
  const cx = w / 2;
  const cy = h / 2;
  const d = k * (R + LABEL_GAP);
  const labels = {} as Record<SectionId, LabelBox>;
  for (const s of SECTION_IDS) {
    const side = SIDES[s];
    const x = side.h === 'right' ? cx + d : cx - d;
    const y = side.v === 'top' ? cy - d : cy + d;
    labels[s] = { x, y, ...side, maxW: Math.max(120, side.h === 'right' ? w - PAD - x : x - PAD) };
  }
  const below = h - (cy + R);
  return { w, h, cx, cy, R, labels, hintY: below >= 40 ? cy + R + 12 : null };
}

/**
 * Where the L1 figure travels when it zooms into a segment: the segment's
 * centroid onto `target` (the L2 ring's centre), scaled up.
 */
export function zoomStyle(layout: OverviewLayout, section: SectionId, target: Pt, scale = 2.6) {
  const { mid } = segmentAngles(section);
  const c = polar(layout.cx, layout.cy, ((RING.main0 + RING.band1) / 2) * layout.R, mid);
  return {
    transformOrigin: `${f(c.x)}px ${f(c.y)}px`,
    transform: `translate(${f(target.x - c.x)}px, ${f(target.y - c.y)}px) scale(${scale})`,
  };
}

/** The question card the stage keeps its centre calm for (~520 x 420, centred). */
const CARD_W = 520;
const STAGE_R_MAX = 230;

export interface StageLayout {
  cx: number;
  cy: number;
  R: number;
  /** The readout column under the ring, left of the card. */
  readout: { left: number; top: number; width: number };
  /** The rail was too narrow: the ring sits behind the card instead, fainter. */
  behind: boolean;
  /** Small enough that fine marks (chevrons, scale, star frames) would be noise: drop them. */
  compact: boolean;
}

/** Below this ring radius the stage draws the compact fidelity tier. */
const COMPACT_BELOW = 150;

/** Stage: the anatomy in the rail left of the centred card, the readout under it. */
export function stageLayout(w: number, h: number): StageLayout {
  const rail = (w - CARD_W) / 2 - PAD * 2;
  if (rail < 150) {
    const R = Math.max(R_MIN, Math.min(w, h) / 2 - PAD);
    return { cx: w / 2, cy: h / 2, R, readout: { left: PAD, top: PAD, width: Math.max(160, rail) }, behind: true, compact: false };
  }
  const R = Math.max(60, Math.min(rail / 2, h * 0.24, STAGE_R_MAX));
  const cx = PAD + rail / 2;
  const cy = PAD + 8 + R;
  return { cx, cy, R, readout: { left: PAD, top: cy + R + 24, width: rail }, behind: false, compact: R < COMPACT_BELOW };
}

/** L2's legend panel width (px) for a canvas `w` wide. */
export const focusPanelWidth = (w: number) => Math.round(Math.min(420, Math.max(300, w * 0.34)));

/** The L2 header's height, for the point the zoom lands on. */
const FOCUS_HEAD = 64;

/** Where the L2 ring's centre sits: the middle of the area left of the panel, under the header. */
export function focusRingCentre(w: number, h: number): Pt {
  return { x: (w - focusPanelWidth(w) - PAD) / 2, y: FOCUS_HEAD + (h - FOCUS_HEAD) / 2 };
}
