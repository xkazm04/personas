// The cadastre's geometry, ported from the winner (`squarify`, `computeLayout`,
// `surveyOrder`): districts are the board's groups laid out as a squarified
// treemap, parcels are each group's contexts in a square grid inside its
// district, and the survey line joins a deed's parcels nearest-neighbour from
// its primary. One function lays out both the map and the miniature in a
// deed's layer.
//
// Changes from the winner, the two the promotion plan names: a district name
// that does not fit wraps at words (hyphenating a word wider than the line)
// onto as many lines as the district has room for, and each district's area
// weight counts its name as well as its contexts (n + 1.2 + chars / 12, where
// the winner used n + 2.2), so a long name in a small group gets the room to
// keep its words; the winner cut them to "Candid...". The platform mark
// follows the parcel's corner (drawn in CadastreMap), not a slider-like bar.
import type { GroupPlot } from '../featuresModel';
import type { ParcelCat } from './cadastreModel';
import { squarify, type Rect } from './squarify';

export type Measure = (text: string, weight: number, size?: number) => number;

/** Canvas text measurement in the page's own font. */
export function makeMeasure(family: string): Measure {
  const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  return (text, weight, size = 13) => {
    if (!ctx) return text.length * size * 0.55;
    ctx.font = `${weight} ${size}px ${family}`;
    return ctx.measureText(text).width;
  };
}

/** Shorten to fit, with an ellipsis, only when nothing else can. */
export function fit(s: string, w: number, weight: number, m: Measure, size = 13): string {
  if (m(s, weight, size) <= w) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (m(`${s.slice(0, mid)}…`, weight, size) <= w) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${s.slice(0, lo).trimEnd()}…` : '';
}

/** Word wrap at spaces. A lone `&` or `/` travels with the word after it, and
 *  a word wider than the line breaks with a hyphen: every letter stays on the
 *  map, where the winner cut "Communication" to "Comm...". */
export function wrapWords(s: string, w: number, weight: number, m: Measure, size = 13): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const toks: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]!;
    if ((word === '&' || word === '/') && i + 1 < words.length) { toks.push(`${word} ${words[i + 1]}`); i += 1; }
    else toks.push(word);
  }
  const lines: string[] = [];
  let cur = '';
  for (const tok of toks) {
    const next = cur ? `${cur} ${tok}` : tok;
    if (m(next, weight, size) <= w) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = tok;
    while (m(cur, weight, size) > w && cur.length > 3) {
      let k = cur.length - 1;
      while (k > 2 && m(`${cur.slice(0, k)}-`, weight, size) > w) k -= 1;
      // never strand one or two letters on a line of their own
      if (cur.length - k < 3) k = Math.max(3, cur.length - 3);
      lines.push(`${cur.slice(0, k)}-`);
      cur = cur.slice(k);
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export interface District extends Rect { id: string; name: string; n: number; i: number; lines: string[]; count: boolean }
export interface Parcel { id: string; name: string; groupName: string; cat: ParcelCat; role: string; x: number; y: number; s: number; cx: number; cy: number; d: number; i: number }
export interface Layout { W: number; H: number; districts: District[]; parcels: Parcel[]; byId: Map<string, Parcel> }

export interface LayoutOptions { pad?: number; head?: number; inset?: number; gap?: number; margin?: number; min?: number; max?: number; labels?: boolean }

const ROLE_RANK: Record<string, number> = { core: 0, platform: 1, tests: 2 };

function districtLines(d: District, head: number, inset: number, m: Measure): number {
  const cw = m(String(d.n), 500) + 10;
  const w1 = d.w - 20 - cw;
  const w2 = d.w - 18;
  d.count = true;
  if (m(d.name, 700) <= w1) { d.lines = [d.name]; return head; }
  if (w2 < 36) { d.lines = []; return head; }
  d.count = false;
  // The winner's two-line fallback, taken to its end: every word keeps its
  // place on as many lines as the district's height leaves room for.
  // Each extra line costs 16px of the parcels' height; the name may take
  // lines while a row of the smallest parcels still fits under it.
  const room = Math.max(1, Math.min(5, 1 + Math.floor((d.h - head - inset - 2 - 4) / 16)));
  const words = wrapWords(d.name, w2, 700, m);
  const lines = words.slice(0, room);
  if (words.length > room) lines[room - 1] = fit(words.slice(room - 1).join(' '), w2, 700, m);
  d.lines = lines.map((l) => fit(l, w2, 700, m));
  return head + 16 * (d.lines.length - 1);
}

export function computeLayout(plots: GroupPlot[], cats: Map<string, ParcelCat>, W: number, H: number, m: Measure, o: LayoutOptions = {}): Layout {
  const pad = o.pad ?? 10;
  const head = o.head ?? 26;
  const inset = o.inset ?? 7;
  const gap = o.gap ?? 2;
  const margin = o.margin ?? 3;
  const groups = plots
    .filter((p) => p.cells.length > 0)
    .map((p) => ({ id: p.group.id, name: p.group.name, cells: p.cells, v: p.cells.length + 1.2 + p.group.name.length / 12 }))
    .sort((a, b) => b.v - a.v || a.name.localeCompare(b.name));
  const rects = groups.length ? squarify(groups, pad, pad, Math.max(50, W - 2 * pad), Math.max(50, H - 2 * pad)) : [];
  const parcels: Parcel[] = [];
  const byId = new Map<string, Parcel>();
  const districts = rects.map((r, di) => {
    const d: District = { id: r.id, name: r.name, x: r.x + margin, y: r.y + margin, w: r.w - 2 * margin, h: r.h - 2 * margin, n: r.cells.length, i: di, lines: [], count: false };
    const hd = o.labels ? districtLines(d, head, inset, m) : head;
    const ix = d.x + inset;
    const iy = d.y + hd + 2;
    const iw = d.w - 2 * inset;
    const ih = d.h - hd - inset - 2;
    const n = r.cells.length;
    let best = { s: 0, cols: 1 };
    for (let cols = 1; cols <= n; cols += 1) {
      const rows = Math.ceil(n / cols);
      const s = Math.min((iw - (cols - 1) * gap) / cols, (ih - (rows - 1) * gap) / rows);
      if (s > best.s) best = { s, cols };
    }
    const s = Math.max(o.min ?? 5, Math.min(best.s, o.max ?? 84));
    // Stable order: the role on the wire, then the name - never the standing,
    // so a change of standing never moves a parcel.
    const cells = [...r.cells].sort((a, b) => (ROLE_RANK[a.context.role] ?? 3) - (ROLE_RANK[b.context.role] ?? 3) || a.context.name.localeCompare(b.context.name));
    cells.forEach((cell, k) => {
      const col = k % best.cols;
      const row = Math.floor(k / best.cols);
      const x = ix + col * (s + gap);
      const y = iy + row * (s + gap);
      const P: Parcel = { id: cell.context.id, name: cell.context.name, groupName: r.name, cat: cats.get(cell.context.id) ?? 'unknown', role: cell.context.role, x, y, s, cx: x + s / 2, cy: y + s / 2, d: di, i: parcels.length };
      parcels.push(P);
      byId.set(P.id, P);
    });
    return d;
  });
  return { W, H, districts, parcels, byId };
}

/** From the primary parcel, nearest neighbour to nearest neighbour. */
export function surveyOrder(contextIds: string[], primaryId: string | null, lay: Layout): Parcel[] {
  const pts = contextIds.map((id) => lay.byId.get(id)).filter((p): p is Parcel => p != null);
  const start = (primaryId ? lay.byId.get(primaryId) : undefined) ?? pts[0];
  if (!start) return [];
  const order = [start];
  const left = pts.filter((p) => p !== start);
  while (left.length) {
    const cur = order[order.length - 1]!;
    let bi = 0;
    let bd = Infinity;
    left.forEach((p, i) => { const dd = (p.cx - cur.cx) ** 2 + (p.cy - cur.cy) ** 2; if (dd < bd) { bd = dd; bi = i; } });
    order.push(left.splice(bi, 1)[0]!);
  }
  return order;
}
