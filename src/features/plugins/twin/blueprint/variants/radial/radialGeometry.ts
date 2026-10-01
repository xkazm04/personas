/**
 * Radial (spark twin-portable-blueprint, WP10): the pure geometry of the
 * anatomy ring. Angles are degrees clockwise from 12 o'clock. Every length is
 * in CSS pixels of the measured canvas, so the SVG draws 1:1 and no label is
 * ever scaled with it (the anti-shrink rule: labels are HTML at full type size,
 * placed from these numbers).
 */
import { SECTION_IDS, type SectionId } from '../../blueprintContract';

export interface Pt {
  x: number;
  y: number;
}

/** An annular sector: the area one glyph draws inside. */
export interface Band {
  cx: number;
  cy: number;
  r0: number;
  r1: number;
  a0: number;
  a1: number;
}

const DEG = Math.PI / 180;
const f = (n: number) => Math.round(n * 100) / 100;

export function polar(cx: number, cy: number, r: number, deg: number): Pt {
  return { x: cx + r * Math.sin(deg * DEG), y: cy - r * Math.cos(deg * DEG) };
}

/** The arc length (px) of `deg` degrees at radius `r`. */
export const arcLength = (r: number, deg: number) => r * deg * DEG;

function circle(cx: number, cy: number, r: number): string {
  return `M${f(cx - r)} ${f(cy)} A${f(r)} ${f(r)} 0 1 1 ${f(cx + r)} ${f(cy)} A${f(r)} ${f(r)} 0 1 1 ${f(cx - r)} ${f(cy)} Z`;
}

/** A full ring (draw with `fill-rule: evenodd`). */
export function ringPath(cx: number, cy: number, r0: number, r1: number): string {
  return r0 > 0 ? `${circle(cx, cy, r1)} ${circle(cx, cy, r0)}` : circle(cx, cy, r1);
}

/** The filled area between two radii and two angles; a full turn becomes a ring. */
export function sectorPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const span = a1 - a0;
  if (span <= 0.01 || r1 - r0 <= 0.01) return '';
  if (span >= 359.99) return ringPath(cx, cy, r0, r1);
  const large = span > 180 ? 1 : 0;
  const o0 = polar(cx, cy, r1, a0);
  const o1 = polar(cx, cy, r1, a1);
  const outer = `M${f(o0.x)} ${f(o0.y)} A${f(r1)} ${f(r1)} 0 ${large} 1 ${f(o1.x)} ${f(o1.y)}`;
  if (r0 <= 0) return `${outer} L${f(cx)} ${f(cy)} Z`;
  const i1 = polar(cx, cy, r0, a1);
  const i0 = polar(cx, cy, r0, a0);
  return `${outer} L${f(i1.x)} ${f(i1.y)} A${f(r0)} ${f(r0)} 0 ${large} 0 ${f(i0.x)} ${f(i0.y)} Z`;
}

/** A sector of a band, by its own fields. */
export const bandPath = (b: Band) => sectorPath(b.cx, b.cy, b.r0, b.r1, b.a0, b.a1);

/** An open arc along one radius, for strokes (a gain, a track, the orbit tick). */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const span = a1 - a0;
  if (span <= 0.01 || r <= 0) return '';
  if (span >= 359.99) {
    const top = polar(cx, cy, r, a0);
    const bottom = polar(cx, cy, r, a0 + 180);
    return `M${f(top.x)} ${f(top.y)} A${f(r)} ${f(r)} 0 1 1 ${f(bottom.x)} ${f(bottom.y)} A${f(r)} ${f(r)} 0 1 1 ${f(top.x)} ${f(top.y)}`;
  }
  const p0 = polar(cx, cy, r, a0);
  const p1 = polar(cx, cy, r, a1);
  return `M${f(p0.x)} ${f(p0.y)} A${f(r)} ${f(r)} 0 ${span > 180 ? 1 : 0} 1 ${f(p1.x)} ${f(p1.y)}`;
}

/** A radial line at one angle, from r0 out to r1. */
export function spokePath(cx: number, cy: number, r0: number, r1: number, deg: number): string {
  const a = polar(cx, cy, r0, deg);
  const b = polar(cx, cy, r1, deg);
  return `M${f(a.x)} ${f(a.y)} L${f(b.x)} ${f(b.y)}`;
}

/** A closed polygon through points. */
export const polygonPoints = (pts: readonly Pt[]) => pts.map((p) => `${f(p.x)},${f(p.y)}`).join(' ');

/** Degrees between neighbouring segments. */
export const SEGMENT_GAP = 8;

/** The four quadrants, clockwise from 12: Identity top-right, Voice bottom-right, Knowledge bottom-left, Training top-left. */
export function segmentAngles(section: SectionId): { a0: number; a1: number; mid: number } {
  const i = SECTION_IDS.indexOf(section);
  const a0 = i * 90 + SEGMENT_GAP / 2;
  const a1 = (i + 1) * 90 - SEGMENT_GAP / 2;
  return { a0, a1, mid: (a0 + a1) / 2 };
}

/** Ring radii as fractions of the figure radius R (the glyph band's outer edge). */
export const RING = {
  hub: 0.19,
  ready0: 0.225,
  ready1: 0.25,
  main0: 0.3,
  main1: 0.45,
  band0: 0.53,
  band1: 1,
} as const;

/** The band a segment's sub-quantities draw in (outside the coverage ring). */
export function glyphBand(cx: number, cy: number, R: number, section: SectionId): Band {
  const { a0, a1 } = segmentAngles(section);
  return { cx, cy, r0: RING.band0 * R, r1: RING.band1 * R, a0: a0 + 1.5, a1: a1 - 1.5 };
}
