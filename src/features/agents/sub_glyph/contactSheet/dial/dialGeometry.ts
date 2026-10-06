/** Pure geometry for the Schematic Dial: where the instrument sits on the
 *  stage, its ring radii, the annular sector paths, the readout columns and
 *  their leader lines, and the exploded fan's magnified wedge. No React.
 *
 *  Angles are the sigil's PETAL_ANGLES: degrees clockwise from 12 o'clock, so
 *  each sector sits exactly where its petal points (trigger 0°, task 45°, ...). */
import type { GlyphDimension } from "@/features/shared/glyph";
import { GLYPH_DIMENSIONS, PETAL_ANGLES } from "@/features/shared/glyph";

export type Pt = { x: number; y: number };

/** Ring radii as fractions of the dial radius R, outermost first. */
export const RADII = {
  outer: 1,
  minorIn: 0.975,
  majorIn: 0.95,
  rimOut: 0.938,
  rimIn: 0.9,
  sectorOut: 0.886,
  sectorIn: 0.806,
  dimArc: 0.79,
  face: 0.775,
} as const;

/** Half a sector's angular span, and the gap left between two sectors. */
export const HALF_SPAN = 22.5;
export const SECTOR_GAP = 3;

/** Readout chip height (two lines) and the min gutter each column needs. */
export const CHIP_H = 48;
const GUTTER_MIN = 184;
const COL_GAP = 18;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** A point at radius r and dial angle deg (clockwise from 12 o'clock). */
export function polar(c: Pt, r: number, deg: number): Pt {
  return { x: c.x + r * Math.sin(rad(deg)), y: c.y - r * Math.cos(rad(deg)) };
}

const f = (n: number) => Math.round(n * 100) / 100;

/** The closed ring segment between radii r0 < r1 from a0 to a1 (clockwise). */
export function annulus(c: Pt, r0: number, r1: number, a0: number, a1: number): string {
  const large = a1 - a0 > 180 ? 1 : 0;
  const o0 = polar(c, r1, a0), o1 = polar(c, r1, a1), i1 = polar(c, r0, a1), i0 = polar(c, r0, a0);
  return `M${f(o0.x)} ${f(o0.y)}A${f(r1)} ${f(r1)} 0 ${large} 1 ${f(o1.x)} ${f(o1.y)}L${f(i1.x)} ${f(i1.y)}A${f(r0)} ${f(r0)} 0 ${large} 0 ${f(i0.x)} ${f(i0.y)}Z`;
}

/** An open arc at radius r; `ccw` runs it backwards (text on the lower half reads upright). */
export function arc(c: Pt, r: number, a0: number, a1: number, ccw = false): string {
  const [s, e] = ccw ? [a1, a0] : [a0, a1];
  const p = polar(c, r, s), q = polar(c, r, e);
  return `M${f(p.x)} ${f(p.y)}A${f(r)} ${f(r)} 0 ${Math.abs(a1 - a0) > 180 ? 1 : 0} ${ccw ? 0 : 1} ${f(q.x)} ${f(q.y)}`;
}

/** A radial tick from r0 to r1 at angle deg, as a path fragment. */
export function radial(c: Pt, r0: number, r1: number, deg: number): string {
  const p = polar(c, r0, deg), q = polar(c, r1, deg);
  return `M${f(p.x)} ${f(p.y)}L${f(q.x)} ${f(q.y)}`;
}

/** A sector's drawn span (its slot minus half the gap on each side). */
export function sectorSpan(dim: GlyphDimension): [number, number] {
  const t = PETAL_ANGLES[dim];
  return [t - HALF_SPAN + SECTOR_GAP / 2, t + HALF_SPAN - SECTOR_GAP / 2];
}

/** Labels on the lower half run backwards so they read upright. */
export const readsBackwards = (deg: number) => deg > 90 && deg < 270;

export interface Readout {
  /** Where the leader leaves the sector, its knee, and where it meets the chip. */
  p0: Pt;
  knee: Pt;
  end: Pt;
  /** +1: the right column (chip starts at end.x); -1: the left (chip ends at end.x). */
  side: 1 | -1;
}

export interface DialLayout {
  c: Pt;
  R: number;
  /** The centre hub: a fixed readable box inscribed in the instrument's face. */
  hub: { w: number; h: number };
  colW: number;
  readouts: Record<GlyphDimension, Readout>;
  /** Free room in the top-left and bottom-right corners (legend, title block). */
  legendRoom: number;
  plateTop: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Size the dial from the stage: as tall as the stage allows, leaving the two
 *  readout columns their gutter. Null until the stage has been measured. */
export function dialLayout(w: number, h: number): DialLayout | null {
  const D = Math.min(h - 16, w - 2 * GUTTER_MIN);
  if (D < 220) return null;
  const R = D / 2;
  const c = { x: w / 2, y: h / 2 };
  const face = R * RADII.face;
  const hubW = clamp(2 * face * 0.82, Math.min(300, 2 * face * 0.94), 440);
  // Inscribed in the face, and clear of the casting orbit above and below it.
  const hubH = Math.min(2 * Math.sqrt(Math.max(0, face * face - (hubW / 2) ** 2)), 2 * (ORBIT.r * Math.cos(rad(ORBIT.half)) * R - 24));
  const colW = Math.min(250, (w - D) / 2 - COL_GAP - 8);
  const readouts = {} as Record<GlyphDimension, Readout>;
  for (const dim of GLYPH_DIMENSIONS) {
    const t = PETAL_ANGLES[dim];
    const side: 1 | -1 = t < 180 ? 1 : -1;
    const p0 = polar(c, R * RADII.sectorOut, t);
    const y = clamp(c.y - Math.cos(rad(t)) * R * 0.97, CHIP_H / 2 + 2, h - CHIP_H / 2 - 2);
    const knee = { x: c.x + side * Math.max(Math.abs(p0.x - c.x), R * 0.42), y };
    readouts[dim] = { p0, knee, end: { x: c.x + side * (R + COL_GAP), y }, side };
  }
  const topChip = readouts.error.end.y - CHIP_H / 2;
  return {
    c, R, hub: { w: hubW, h: hubH }, colW, readouts,
    legendRoom: topChip - 14,
    plateTop: readouts.message.end.y + CHIP_H / 2 + 10,
  };
}

/** The casting orbit: twelve silhouettes in two arcs above and below the hub. */
export const ORBIT = { r: 0.66, half: 37.5 } as const;

export function orbitSlot(i: number, n: number, c: Pt, R: number): Pt {
  const perArc = Math.ceil(n / 2);
  const top = i < perArc;
  const k = top ? i : i - perArc;
  const count = top ? perArc : n - perArc;
  const step = count > 1 ? (2 * ORBIT.half) / (count - 1) : 0;
  const deg = top ? -ORBIT.half + k * step : 180 + ORBIT.half - k * step;
  return polar(c, R * ORBIT.r, deg);
}

/** Centroid-ish point of a sector, where a camera pushes in and a pull-out starts. */
export function sectorPoint(c: Pt, R: number, dim: GlyphDimension): Pt {
  return polar(c, R * ((RADII.sectorOut + RADII.sectorIn) / 2), PETAL_ANGLES[dim]);
}

// -- the exploded fan --------------------------------------------------------

/** The fan opens east, drawn at 70° for the sector's real 45°: the scale is
 *  stretched, not relabelled, so its numerals stay the dial's own degrees. */
export const FAN_HALF = 35;
const FAN_K = 0.42;
const LABEL_ROOM = 160;

export interface FanLayout { apex: Pt; rO: number; rI: number }

export function fanLayout(w: number, h: number): FanLayout | null {
  const cos = Math.cos(rad(FAN_HALF));
  const rO = Math.min((h - 28) / (2 * Math.sin(rad(FAN_HALF))), (w - LABEL_ROOM - 24) / (1 - FAN_K * cos));
  if (rO < 120) return null;
  const rI = FAN_K * rO;
  const width = rO - rI * cos + LABEL_ROOM;
  return { apex: { x: (w - width) / 2 - rI * cos, y: h / 2 }, rO, rI };
}

/** A point on the fan at radius r and fan angle phi (0 = east, + = clockwise). */
export function fanPolar(a: Pt, r: number, phi: number): Pt {
  return { x: a.x + r * Math.cos(rad(phi)), y: a.y + r * Math.sin(rad(phi)) };
}

/** A ring segment of the fan between radii r0 < r1 from phi0 to phi1. */
export function fanAnnulus(a: Pt, r0: number, r1: number, p0: number, p1: number): string {
  const o0 = fanPolar(a, r1, p0), o1 = fanPolar(a, r1, p1), i1 = fanPolar(a, r0, p1), i0 = fanPolar(a, r0, p0);
  return `M${f(o0.x)} ${f(o0.y)}A${f(r1)} ${f(r1)} 0 0 1 ${f(o1.x)} ${f(o1.y)}L${f(i1.x)} ${f(i1.y)}A${f(r0)} ${f(r0)} 0 0 0 ${f(i0.x)} ${f(i0.y)}Z`;
}

/** The dial's real angle at fan angle phi, for a sector centred on theta. */
export const realAngle = (theta: number, phi: number) => theta + (phi * HALF_SPAN) / FAN_HALF;
export const fanAngle = (theta: number, real: number) => ((real - theta) * FAN_HALF) / HALF_SPAN;
