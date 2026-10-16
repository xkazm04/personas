// The revisions chart's model (PORTED from bp BaseBar.tsx Revisions): its geometry, the stacked stage bands (features
// by stage per weekly snapshot), the milestones and releases it flags, and its label candidates, as one pure function
// of the panel's size, the map, the time shown and the words. Revisions.tsx only draws what this returns.
// EDIT (port): bp's simulated hour ahead and its live-run zone are not drawn here: the history takes the width, less a
// future margin when a planned milestone lies ahead (bp's dashed line to the GA flag). Releases come from the store.
import type { Milestone, Snapshot, Stage } from '../../standard/load';
import type { Release } from '@/lib/lensScan/wire';
import { daysBetween } from './dates';
import { histX, type ScrubGeom } from './scrub';
import { boxOf, CW, headW, placeLabels, type Box, type Lab } from './revLabels';

/** Each stage's band, bottom band first, and its fill (bp FILLS). Keyed by Stage so a stage the standard adds fails here. */
export const FILLS: Record<Stage, number> = { live: 0.62, flagged: 0.44, 'in-review': 0.3, 'in-dev': 0.2, specified: 0.11, idea: 0.06, deprecated: 0.5 };
export const ORDER = Object.keys(FILLS) as Stage[];

export interface RevWords {
  title: string; titleShort: string; weeks(n: number): string; max(n: number): string; step: string;
  band(st: Stage, n: number): string; day(d: string): string; days(n: number): string; plate(now: boolean): string;
}
export interface RevIn { W: number; H: number; weeks: readonly string[]; snapshots: readonly Snapshot[]; milestones: readonly Milestone[]; asOf: string; t: string; releases: readonly Release[]; words: RevWords }
export interface Band { st: Stage; points: string; rect: { x: number; y: number; w: number; h: number } | null }

export function revModel(i: RevIn) {
  const { W, H, weeks, snapshots: snaps, asOf, t, words: w } = i;
  const L = 76, R = W - 6, avail = R - L, top = H < 80 ? 21 : 34, bot = H < 80 ? H - 28 : Math.min(H - 28, 66);
  const m2 = i.milestones.find((m) => m.state !== 'done' && m.date > asOf) ?? null, xm = R - 14;
  const h1 = m2 ? L + avail - Math.max(0, Math.round(avail * 0.16) - 26) : R;
  const g: ScrubGeom = { h0: L, h1, weeks, asOf }, hx = (d: string) => histX(g, d), NW = weeks.length, now = t >= asOf;
  const max = Math.max(...snaps.map((x) => x.total), 0) * 1.05 || 1, y = (v: number) => bot - (v / max) * (bot - top);
  const cum = snaps.map(() => 0);
  const bands: Band[] = ORDER.map((st) => {
    if (snaps.length < 2) {
      // one snapshot (or none: an empty map draws no band at all, rather than a band of zero)
      const first = snaps[0];
      if (!first) return { st, points: '', rect: null };
      const c0 = cum[0] ?? 0, c1 = c0 + first.counts[st]; cum[0] = c1;
      return { st, points: '', rect: { x: h1 - 14, y: y(c1), w: 14, h: Math.max(0, y(c0) - y(c1)) } };
    }
    const up: string[] = [], dn: string[] = [];
    snaps.forEach((sn, k) => { const x = hx(sn.week).toFixed(1); const c0 = cum[k] ?? 0, c1 = c0 + sn.counts[st]; cum[k] = c1; dn.push(x + ',' + y(c0).toFixed(1)); up.push(x + ',' + y(c1).toFixed(1)); });
    return { st, points: up.join(' ') + ' ' + dn.reverse().join(' '), rect: null };
  });
  // direct band labels at the right edge: the stage and its count on the shown date, where the band is tall enough
  const sel = snaps.filter((sn) => sn.week <= t).pop() ?? snaps[0], edge = snaps[snaps.length - 1], cand: Lab[] = [];
  if (edge && sel) {
    let acc = 0;
    for (const st of ORDER) {
      const c = edge.counts[st], hgt = (c / max) * (bot - top), mid = bot - ((acc + c / 2) / max) * (bot - top);
      acc += c;
      if (hgt >= 15) cand.push({ k: 'b_' + st, s: w.band(st, sel.counts[st]), x: h1 - (snaps.length < 2 ? 18 : 4), y: mid + 4, a: 'end', p: 6 });
    }
  }
  const bandKeys = cand.map((l) => l.k);
  const hl = Math.min(hx(t), h1), lab = w.plate(now), pw = Math.max(108, Math.ceil(lab.length * CW) + 16), px0 = Math.max(L - 6, Math.min(hl - pw / 2, h1 - pw + 12));
  const m1 = i.milestones.filter((m) => m.state === 'done' && (!weeks[0] || m.date >= weeks[0])).pop() ?? null;
  const rels = i.releases.map((r) => ({ id: r.id, x: hx(r.created_at.slice(0, 10)), s: r.version })).filter((r) => r.x >= L && r.x <= h1);
  const title = headW(w.title) <= R - 2 ? w.title : w.titleShort;
  const pxWeek = NW > 1 ? (h1 - L) / (NW - 1) : h1 - L, wk = Math.max(1, Math.ceil((6 * CW + 12) / Math.max(1, pxWeek)));
  cand.push(
    { k: 'rev', s: title, x: 2, y: top - 24, a: 'start', p: 0, w: headW(title) },
    { k: 'nw', s: w.weeks(NW), x: 2, y: top + 2, a: 'start', p: 1 },
    { k: 'sc', s: w.max(Math.round(max / 1.05)), x: 2, y: top + 18, a: 'start', p: 3 },
    ...(NW > 1 ? [{ k: 'step', s: w.step, x: 2, y: top + 34, a: 'start', p: 1 } as Lab] : []),
    ...(m1 ? [{ k: 'm1', s: (m1.code ? m1.code + ' ' : '') + m1.name.toUpperCase(), x: hx(m1.date) + 13, y: top - 9, a: 'start', p: 2 } as Lab] : []),
    ...(m2 ? [{ k: 'm2', s: (m2.code || m2.name) + ' · ' + w.day(m2.date), x: xm - 13, y: top - 7, a: 'end', p: 2 } as Lab] : []),
    ...(m2 ? [{ k: 'days', s: w.days(daysBetween(asOf, m2.date)), x: xm - 4, y: bot - 20, a: 'end', p: 2 } as Lab] : []),
    ...rels.map((r) => ({ k: 'r_' + r.id, s: r.s, x: r.x + 4, y: top + 8, a: 'start', p: 3 }) as Lab),
    ...snaps.flatMap((sn, k) => (k % wk === 0 || k === NW - 1 ? [{ k: 'w' + k, s: w.day(sn.week), x: hx(sn.week), y: bot + 17, a: 'middle', p: 4 } as Lab] : [])),
  );
  const kept: Box[] = [{ x0: px0, x1: px0 + pw, y0: bot + 7, y1: bot + 29 }];
  const shown = placeLabels(cand, W, kept);
  return { g, L, R, top, bot, h1, xm, hx, bands, bandKeys, cand, shown, boxOf, m1, m2, rels, plate: { hl, px0, pw, lab }, still: NW < 2 };
}
