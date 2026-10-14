import type { SpineModel } from '../../engine/spine';
import type { Geo, Measure } from './geometry';
import { f1 } from './noise';

/** The words the map writes, already translated. Built by the view, so this module stays pure. */
export interface MapWords {
  marshLong: (c: number) => string;
  marshShort: (c: number) => string;
  lakeLong: (c: number) => string;
  lakeShort: (c: number) => string;
  spring: string;
  setOut: (n: number) => string;
  place: (q: number) => string;
  ghost: string;
  /** Longest first; the first that fits the reach between two settlements is written. */
  waitForms: (q: number) => string[];
  deltaHead: string;
}

export type LabelClass = 'marsh' | 'lake' | 'place' | 'sub' | 'ghost';
export interface PlacedText { key: string; cls: LabelClass; x: number; y: number; text: string; q?: number }
export interface WaitText { q: number; d: string; text: string }
export interface MapLabels { texts: PlacedText[]; waits: WaitText[]; deltaHead: string[]; dropped: number }

interface Box { x: number; y: number; w: number; h: number }

/**
 * Place the map's labels against an occupancy budget: the river, the lakes and marshes, the
 * leaders and the delta column are obstacles, and a label goes to the first candidate spot that
 * is inside the map and free. What cannot fit is held back and counted (every figure is on the
 * plates anyway), so the map never overprints itself at any size.
 */
export function allocLabels(g: Geo, m: SpineModel, words: MapWords, measure: Measure, ghost: boolean): MapLabels {
  const occ: Box[] = [];
  const texts: PlacedText[] = [];
  let dropped = 0;
  const hit = (r: Box) => occ.some((o) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y);
  const inside = (r: Box) => r.x >= 4 && r.x + r.w <= g.W - 4 && r.y >= g.Tz - 4 && r.y + r.h <= g.Mb + 2;
  const place = (cands: Box[], mk: (r: Box) => void) => {
    for (const r of cands) if (inside(r) && !hit(r)) { occ.push(r); mk(r); return true; }
    return false;
  };
  for (let x = g.xA - 10; x < g.xB; x += 16) {
    const t = Math.min(g.top(x), g.top(x + 16)), b = Math.max(g.bot(x), g.bot(x + 16));
    occ.push({ x, y: t - 2, w: 16, h: b - t + 4 });
  }
  for (const bl of g.blobs) occ.push({ x: bl.cx - bl.rx - 4, y: bl.cy - bl.ry - 8, w: bl.rx * 2 + 8, h: bl.ry * 2 + 14 });
  for (const x of g.x) occ.push({ x: x - 3, y: g.bot(x), w: 6, h: g.Mb - g.bot(x) });
  occ.push({ x: g.xB, y: 0, w: g.W, h: g.H });

  const fs = g.fs, hgt = fs * 1.3;
  // Lake and marsh counts first: they carry the conserved flow.
  for (const bl of [...g.blobs].sort((a, b) => b.c - a.c)) {
    const isM = bl.type === 'marsh';
    const cls: LabelClass = isM ? 'marsh' : 'lake';
    const weight = isM ? 600 : 400;
    const txt = isM ? words.marshLong(bl.c) : words.lakeLong(bl.c);
    const w = measure(txt, fs, weight);
    const below = { x: bl.cx - w / 2, y: bl.cy + bl.ry + 8, w, h: hgt }, above = { x: bl.cx - w / 2, y: bl.cy - bl.ry - 8 - hgt, w, h: hgt };
    const right = { x: bl.cx + bl.rx + 8, y: bl.cy - hgt / 2, w, h: hgt }, left = { x: bl.cx - bl.rx - 8 - w, y: bl.cy - hgt / 2, w, h: hgt };
    const cands = isM
      ? [below, right, left, { ...below, x: below.x + 24 }, { ...below, x: below.x - 24 }]
      : [above, right, left, { ...above, x: above.x + 24 }];
    const mk = (text: string) => (r: Box) => texts.push({ key: `${cls}${bl.q}`, cls, x: r.x, y: r.y + fs * 0.98, text, q: bl.q });
    if (place(cands, mk(txt))) continue;
    const short = isM ? words.marshShort(bl.c) : words.lakeShort(bl.c), sw = measure(short, fs, weight);
    const ok = place([{ x: bl.cx - sw / 2, y: below.y, w: sw, h: hgt }, { x: bl.cx - sw / 2, y: above.y, w: sw, h: hgt }, { x: bl.cx + bl.rx + 6, y: bl.cy - hgt / 2, w: sw, h: hgt }], mk(short));
    if (!ok) dropped++;
  }

  const setOut = words.setOut(g.n);
  const sw2 = Math.max(measure(words.spring.toUpperCase(), fs, 600, 0.22), measure(setOut, fs));
  const springOk = place([{ x: g.xA - 14, y: g.bot(g.xA) + 12, w: sw2, h: fs * 2.6 }, { x: g.xA - 14, y: g.top(g.xA) - 12 - fs * 2.6, w: sw2, h: fs * 2.6 }], (r) => {
    texts.push({ key: 'spring', cls: 'place', x: r.x, y: r.y + fs, text: words.spring });
    texts.push({ key: 'spring-sub', cls: 'sub', x: r.x, y: r.y + fs * 2.3, text: setOut });
  });
  if (!springOk) dropped++;

  m.stations.forEach((_, q) => {
    const name = words.place(q).toUpperCase(), w = measure(name, fs, 600, 0.22), x = g.x[q]!, tp = g.top(x);
    const ok = place([{ x: x - w / 2, y: tp - 14 - hgt, w, h: hgt }, { x: x - w - 4, y: tp - 14 - hgt, w, h: hgt }, { x: x - w / 2, y: tp - 40 - hgt, w, h: hgt }, { x: x + 4, y: tp - 14 - hgt, w, h: hgt }],
      (r) => texts.push({ key: `place${q}`, cls: 'place', x: r.x, y: r.y + fs * 0.98, text: words.place(q), q }));
    if (!ok) dropped++;
  });

  if (ghost) {
    const gw = measure(words.ghost, fs);
    const ok = place([{ x: g.xB - gw - 10, y: g.Mb - fs * 1.6, w: gw, h: hgt }, { x: g.xA + 10, y: g.Mb - fs * 1.6, w: gw, h: hgt }, { x: g.xA + 10, y: g.Tz + 4, w: gw, h: hgt }],
      (r) => texts.push({ key: 'ghost', cls: 'ghost', x: r.x, y: r.y + fs, text: words.ghost }));
    if (!ok) dropped++;
  }

  // Waits are written in the river along its course, the way a map names a river.
  const waits: WaitText[] = [];
  m.stations.forEach((s, q) => {
    if (!q || !Number.isFinite(s.medWait)) return;
    const a = g.x[q - 1]! + 0.14 * g.sp, b = g.x[q]! - 0.22 * g.sp;
    const text = words.waitForms(q).find((t) => measure(t, fs) <= (b - a) * 1.02);
    if (!text) { dropped++; return; }
    let d = '';
    for (let x = a - 30; x <= b + 30; x += 4) d += (d ? 'L' : 'M') + f1(x) + ' ' + f1((g.top(x) + g.bot(x)) / 2 + fs * 0.34);
    waits.push({ q, d, text });
  });

  const room = g.W - (g.xM + 34 * g.U) - 10;
  const head = words.deltaHead;
  const cut = head.lastIndexOf(' ');
  const deltaHead = measure(head.toUpperCase(), fs, 600, 0.24) <= room || cut < 0 ? [head] : [head.slice(0, cut), head.slice(cut + 1)];
  return { texts, waits, deltaHead, dropped };
}
