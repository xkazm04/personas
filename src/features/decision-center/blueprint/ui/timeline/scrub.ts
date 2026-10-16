// The one x <-> time mapping of the two time sliders (PORTED from bp src/components/timeline/scrub.ts and keys.ts): the
// strip's hairline and the panel's revisions chart. History x for a date, the date a pointer x lands on (the nearest
// week, snapping to now at the right end), a week step, and the slider's key map. Pure and React-free.
// EDIT (port): bp's simulated hour ahead (its zone, `hourX`, `hourAt`, the forward-only seek) is simulation and is
// not brought; the history takes the whole width. Every date here is a YYYY-MM-DD string: no Date is built.
import { dnum } from '../../model/layout';

/** Within this many px of the history's right end the pointer snaps to now (bp NOW_SNAP). */
export const NOW_SNAP = 3;

/** A slider's geometry in its own svg units: the history axis from h0 to h1, the weeks, and now (the map's as-of date). */
export interface ScrubGeom { h0: number; h1: number; weeks: readonly string[]; asOf: string }

const span = (g: ScrubGeom) => { const d0 = g.weeks.length ? dnum(g.weeks[0]!) : dnum(g.asOf); return { d0, d1: dnum(g.asOf) }; };

/** x of a date on the history axis. With no span (one week of history) everything sits at now, the right end. */
export function histX(g: ScrubGeom, d: string): number {
  const { d0, d1 } = span(g);
  return d1 > d0 ? g.h0 + ((dnum(d) - d0) / (d1 - d0)) * (g.h1 - g.h0) : g.h1;
}

/** The history can move only with two or more weeks. */
export const canTravel = (weeks: readonly string[]) => weeks.length > 1;

/** The dates a slider stops at: every week before now, then now itself. */
export function stops(g: Pick<ScrubGeom, 'weeks' | 'asOf'>): string[] {
  return [...g.weeks.filter((w) => w < g.asOf), g.asOf];
}

/** The date a drag at x means: the nearest stop, now within NOW_SNAP of the right end. */
export function dateAt(g: ScrubGeom, x: number): string {
  if (!canTravel(g.weeks) || x > g.h1 - NOW_SNAP) return g.asOf;
  let best = g.asOf, bd = Infinity;
  for (const w of stops(g)) { const d = Math.abs(histX(g, w) - x); if (d < bd) { bd = d; best = w; } }
  return best;
}

/** One week along the history from `t` (dir -1 back, +1 forward), clamped to the first week and now. */
export function stepWeek(g: Pick<ScrubGeom, 'weeks' | 'asOf'>, t: string, dir: number): string {
  const s = stops(g);
  let i = s.indexOf(t);
  if (i < 0) { i = 0; for (let j = 0; j < s.length; j++) if (s[j]! <= t) i = j; }
  return s[Math.max(0, Math.min(s.length - 1, i + dir))]!;
}

/** The asOf a slider sends for a date: null at now (the plan is drawn as it stands). */
export const asOfFor = (asOf: string, d: string): string | null => (d >= asOf ? null : d);

/** A time slider's keys (bp keys.ts timeSliderKey): the date a key moves to, or undefined when the key is not the slider's.
 *  Enter is claimed and stays put: from a slider it must not reach the sheet, where it would descend a level. */
export function sliderKey(key: string, g: Pick<ScrubGeom, 'weeks' | 'asOf'>, t: string): string | undefined {
  switch (key) {
    case 'ArrowLeft': case 'ArrowDown': return stepWeek(g, t, -1);
    case 'ArrowRight': case 'ArrowUp': return stepWeek(g, t, 1);
    case 'Home': return stops(g)[0];
    case 'End': return g.asOf;
    case 'Enter': return t;
    default: return undefined;
  }
}

/** Key plan click -> the fraction of the box to fly to (bp keyPlanFrac): a keyboard activation (detail 0) is the centre. */
export function keyPlanFrac(clientX: number, clientY: number, r: { left: number; top: number; width: number; height: number }, detail: number): [number, number] {
  if (!(r.width > 0 && r.height > 0)) return [0.5, 0.5];
  const fx = (clientX - r.left) / r.width, fy = (clientY - r.top) / r.height;
  if (detail === 0 || fx < 0 || fx > 1 || fy < 0 || fy > 1) return [0.5, 0.5];
  return [fx, fy];
}
