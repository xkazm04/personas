// The spread cross-section, painted: one row per altitude of the descent,
// every subject a bar as tall as its techniques and coloured by its claim, a
// bracket on the row above opening through a funnel into the row below, the
// row gutters as the breadcrumb, and under the reader's pointer a PREVIEW
// row of the level they have not entered yet. Ported from the winner's
// `drawSpread`; the numbers are the winner's.
import type { EnginePath } from '../engine/GalaxyEngine';
import type { GalaxyLayout, GalaxyNode, SubjectNode, TechniqueNode } from '../engine/types';
import { orderedSubjects, subcategoryTitle } from './careModel';
import { levelOf, nodeTitle } from './fusedModel';
import { alpha, toneColor, type InstrumentColors } from './tokenColors';
import { careTone } from './careModel';

export const ROW_H = 44;
export const FUNNEL = 14;
export const GUT = 184;
export const HEAD_H = 37;
const PADR = 14;

type Scope = GalaxyNode | null;
export interface Row {
  i: number;
  scope: Scope;
  committed: boolean;
}
export interface SpreadHit {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  node: GalaxyNode | null;
  climb?: boolean;
  unit?: boolean;
  i: number;
}
export interface SpreadWords {
  tag: (i: number) => string;
  unit: (i: number, n: number) => string;
  point: (i: number) => string;
  rest: (i: number) => string;
  everyDomain: string;
}

const pathNode = (p: EnginePath, i: number): Scope => (i === 1 ? p.domain : i === 2 ? p.category : i === 3 ? p.subject : null);
const levelNode = (n: GalaxyNode): number => (n.kind === 'domain' ? 1 : n.kind === 'category' ? 2 : n.kind === 'subject' ? 3 : 4);
const parentOf = (n: GalaxyNode): GalaxyNode | null =>
  n.kind === 'technique' ? n.subject : n.kind === 'subject' ? n.category : n.kind === 'category' ? n.domain : null;

export function rowsWanted(path: EnginePath, preview: GalaxyNode | null): Row[] {
  const lvl = Math.min(3, levelOf(path));
  const rows: Row[] = [];
  for (let i = 0; i <= lvl; i += 1) rows.push({ i, scope: pathNode(path, i), committed: true });
  if (lvl < 3) {
    let n = preview;
    while (n && levelNode(n) > lvl + 1) n = parentOf(n);
    const fits = n && levelNode(n) === lvl + 1 && (lvl === 0 || parentOf(n) === pathNode(path, lvl));
    rows.push({ i: lvl + 1, scope: fits ? n : null, committed: false });
  }
  return rows;
}

export function spreadHeight(rows: number): number {
  return HEAD_H + rows * ROW_H + (rows - 1) * FUNNEL + 10;
}

interface Units {
  units: Array<SubjectNode | TechniqueNode>;
  groups: Array<{ node: GalaxyNode | null; title: string; from: number; to: number }>;
}

function unitsOf(layout: GalaxyLayout, scope: Scope, i: number): Units {
  if (i === 3 && scope?.kind === 'subject') return { units: scope.techniques, groups: [{ node: scope, title: '', from: 0, to: scope.techniques.length }] };
  const units: SubjectNode[] = [];
  const groups: Units['groups'] = [];
  if (i === 2 && scope?.kind === 'category') {
    for (const s of orderedSubjects(layout, scope)) {
      const last = groups[groups.length - 1];
      const key = s.subcategory ?? '';
      if (!last || last.title !== subcategoryTitle(key)) groups.push({ node: null, title: subcategoryTitle(key), from: units.length, to: units.length });
      units.push(s);
      const g = groups[groups.length - 1];
      if (g) g.to = units.length;
    }
    return { units, groups };
  }
  const kids: GalaxyNode[] = !scope ? layout.domains : scope.kind === 'domain' ? scope.categories : [];
  for (const k of kids) {
    const from = units.length;
    units.push(...orderedSubjects(layout, k.kind === 'domain' || k.kind === 'category' ? k : null));
    groups.push({ node: k, title: `${k.rank}  ${nodeTitle(k)}`, from, to: units.length });
  }
  return { units, groups };
}

export function paintSpread(
  g: CanvasRenderingContext2D,
  W: number,
  H: number,
  layout: GalaxyLayout,
  path: EnginePath,
  rows: Row[],
  col: InstrumentColors,
  words: SpreadWords,
  hover: GalaxyNode | null,
  waitingStars: Set<string>,
  lit: Set<string> | null,
): SpreadHit[] {
  const hits: SpreadHit[] = [];
  const x0 = GUT;
  const span = W - PADR - x0;
  const font = (w: number, s: number) => `${w} ${s}px ${col.font}`;
  let prev: { x0: number; x1: number; y: number; committed: boolean } | null = null;
  const lastCommitted = rows.filter((r) => r.committed).length - 1;
  rows.forEach((row, ri) => {
    const y = ri * (ROW_H + FUNNEL) + 4;
    if (y > H) return;
    const i = row.i;
    const cur = row.committed && ri === lastCommitted;
    const U = row.scope || i === 0 ? unitsOf(layout, row.scope, i) : null;
    g.textAlign = 'left';
    g.font = font(600, 13);
    g.fillStyle = cur ? col.accent : col.muted;
    g.globalAlpha = row.committed ? 1 : 0.85;
    g.fillText(U ? `${words.tag(i)} · ${words.unit(i, U.units.length)}` : words.tag(i), 14, y + 15);
    g.font = font(cur ? 700 : 500, 14);
    g.fillStyle = row.committed ? col.fg : col.muted;
    let nm = row.scope ? nodeTitle(row.scope) : i === 0 ? words.everyDomain : words.point(i);
    if (g.measureText(nm).width > GUT - 30) {
      const w = nm.split(' ');
      while (w.length > 1 && g.measureText(`${w.join(' ')}…`).width > GUT - 30) w.pop();
      nm = `${w.join(' ')}…`;
    }
    g.fillText(nm + (row.committed && !cur ? ' ↑' : ''), 14, y + 34);
    if (row.committed && !cur) hits.push({ x0: 0, x1: GUT - 10, y0: y, y1: y + ROW_H, node: row.scope, climb: true, i });
    g.globalAlpha = 1;
    if (!U || U.units.length === 0) {
      g.font = font(400, 14);
      g.fillStyle = col.muted;
      g.fillText(words.rest(i), x0, y + 27);
      prev = null;
      return;
    }
    const n = U.units.length;
    const ngaps = U.groups.length - 1;
    const gap = ngaps ? Math.min(8, Math.max(2, (span * 0.08) / ngaps)) : 0;
    const uw = (span - gap * ngaps) / n;
    const ux = (k: number) => {
      let gi = 0;
      while (gi < U.groups.length - 1 && k >= (U.groups[gi]?.to ?? 0)) gi += 1;
      return x0 + k * uw + gi * gap;
    };
    const labTop = y + 2;
    const tickTop = y + 20;
    const tickBot = y + ROW_H - 3;
    for (const gr of U.groups) {
      const gx0 = ux(gr.from);
      const gx1 = ux(gr.to - 1) + uw;
      const sel = i < 2 && gr.node !== null && pathNode(path, i + 1) === gr.node;
      g.fillStyle = sel ? col.accent : col.muted;
      g.globalAlpha = sel ? 0.16 : 0.06;
      g.fillRect(gx0, labTop, gx1 - gx0, ROW_H - 4);
      g.globalAlpha = 1;
      let t = i === 3 ? '' : gr.title;
      g.font = font(sel ? 700 : 600, 13);
      if (t && g.measureText(t).width > gx1 - gx0 - 6) t = i === 2 || !gr.node ? '' : String(gr.node.rank);
      if (t && g.measureText(t).width <= gx1 - gx0 - 4) {
        g.fillStyle = sel ? col.accent : col.fg;
        g.globalAlpha = row.committed ? 0.95 : 0.7;
        g.fillText(t, gx0 + 3, labTop + 13);
        g.globalAlpha = 1;
      }
      if (i < 2 && gr.node) hits.push({ x0: gx0, x1: gx1, y0: labTop, y1: tickTop, node: gr.node, i });
    }
    U.units.forEach((u, k) => {
      const ux0 = ux(k);
      const w = Math.max(1, uw - (uw > 3 ? 1 : 0));
      let h: number;
      let color: string;
      let a: number;
      let cap = false;
      if (u.kind === 'technique') {
        h = tickBot - tickTop;
        color = path.technique === u ? col.purple : col.none;
        a = path.technique === u ? 0.95 : 0.34;
      } else {
        h = 5 + (tickBot - tickTop - 5) * Math.sqrt(u.techniques.length / 27);
        const claimed = u.mark !== 'none' || (lit?.has(u.slug) ?? false);
        color = lit?.has(u.slug) ? col.accent : claimed ? toneColor(col, careTone(u, waitingStars)) : col.none;
        a = claimed ? 1 : 0.34;
        cap = claimed;
        if (lit && !lit.has(u.slug)) a *= 0.45;
        if (path.subject === u) {
          color = col.accent;
          a = 1;
          cap = true;
        }
      }
      if (hover === u) {
        color = col.accent;
        a = 1;
        cap = true;
      }
      g.globalAlpha = row.committed ? a : a * 0.8;
      const grad = g.createLinearGradient(0, tickTop, 0, tickBot);
      grad.addColorStop(0, color);
      grad.addColorStop(1, alpha(color, 0.42));
      g.fillStyle = grad;
      g.fillRect(ux0, tickBot - h, w, h);
      if (cap) {
        g.fillStyle = color;
        g.fillRect(ux0, tickBot - h, w, 1.5);
      }
      if (u.kind === 'subject' && waitingStars.has(u.slug)) {
        const cx = ux0 + w / 2;
        g.globalAlpha = 1;
        g.fillStyle = col.warn;
        g.beginPath();
        g.moveTo(cx, tickBot - h - 2);
        g.lineTo(cx - 4, tickBot - h - 9);
        g.lineTo(cx + 4, tickBot - h - 9);
        g.closePath();
        g.fill();
      }
      g.globalAlpha = 1;
      if (i >= 2) {
        const full = `${u.rank}  ${nodeTitle(u)}`;
        g.font = font(600, 13);
        let t = String(u.rank);
        if (uw > 60) {
          const w2 = full.split(' ');
          while (w2.length > 2 && g.measureText(`${w2.join(' ')}…`).width > uw - 6) w2.pop();
          const cand = w2.join(' ') + (w2.length < full.split(' ').length ? '…' : '');
          if (g.measureText(cand).width <= uw - 6) t = cand;
        }
        if (g.measureText(t).width <= uw - 4) {
          const onBar = (u.kind === 'technique' && path.technique === u) || (u.kind === 'subject' && (u.mark !== 'none' || path.subject === u));
          g.fillStyle = onBar ? col.bg : col.fg;
          g.globalAlpha = 0.95;
          g.fillText(t, ux0 + 3, tickBot - 5);
          g.globalAlpha = 1;
        }
      }
      hits.push({ x0: ux0, x1: ux0 + Math.max(uw, 1), y0: tickTop - 10, y1: tickBot, node: u, i, unit: true });
    });
    let br: { x0: number; x1: number; committed: boolean } | null = null;
    const nextSel = i < 3 ? (pathNode(path, i + 1) ?? rows[ri + 1]?.scope ?? null) : null;
    if (nextSel) {
      const idx: number[] = [];
      U.units.forEach((u, k) => {
        let a: GalaxyNode | null = u;
        while (a && a !== nextSel) a = parentOf(a);
        if (a) idx.push(k);
      });
      const first = idx[0];
      const last = idx[idx.length - 1];
      if (first !== undefined && last !== undefined) {
        br = { x0: ux(first), x1: ux(last) + uw, committed: rows[ri + 1]?.committed ?? false };
        g.strokeStyle = col.accent;
        g.lineWidth = 2;
        g.globalAlpha = br.committed ? 1 : 0.6;
        g.strokeRect(br.x0 - 1, tickTop - 12, br.x1 - br.x0 + 2, tickBot - tickTop + 14);
        g.globalAlpha = 1;
      }
    }
    if (prev) funnel(g, col, prev, x0, W - PADR, y);
    prev = br ? { ...br, y: tickBot + 3 } : null;
  });
  return hits;
}

function funnel(g: CanvasRenderingContext2D, col: InstrumentColors, b: { x0: number; x1: number; y: number; committed: boolean }, to0: number, to1: number, yTop: number): void {
  g.fillStyle = col.accent;
  g.globalAlpha = b.committed ? 0.12 : 0.07;
  g.beginPath();
  g.moveTo(b.x0, b.y);
  g.lineTo(b.x1, b.y);
  g.lineTo(to1, yTop + 2);
  g.lineTo(to0, yTop + 2);
  g.closePath();
  g.fill();
  g.strokeStyle = col.accent;
  g.globalAlpha = b.committed ? 0.5 : 0.3;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(b.x0, b.y);
  g.lineTo(to0, yTop + 2);
  g.moveTo(b.x1, b.y);
  g.lineTo(to1, yTop + 2);
  g.stroke();
  g.globalAlpha = 1;
}
