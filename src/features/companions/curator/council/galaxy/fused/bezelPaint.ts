// The bezel, painted: smoked glass round the field, four nested bands with
// one notch per technique, arc labels where they fit, the lit breadcrumb
// arcs, compass ticks, amber blips where waiting decisions sit, and the
// lubber mark at 12 o'clock. Opening engraves the dial outward from 12
// o'clock in both directions while the glass settles onto its rim. Ported
// from the winner's `drawBezel`; the numbers are the winner's, the colours
// are the product's tokens.
import type { GalaxyNode, SubjectNode, TechniqueNode } from '../engine/types';
import { nodeTitle } from './fusedModel';
import type { DialIndex, DialMotion, DialNode } from './bezelDial';
import { bandRadii, paintBlips, paintRim } from './bezelRim';
import type { InstrumentColors } from './tokenColors';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export interface BezelScene {
  cx: number;
  cy: number;
  /** Glass radius as drawn (wider while opening). */
  rg: number;
  sc: number;
  open: number;
  thick: number[];
  focusPath: Set<GalaxyNode>;
  childOf: (n: DialNode) => boolean;
  pinned: TechniqueNode | null;
  hover: GalaxyNode | null;
  lit: Set<string> | null;
  waiting: SubjectNode[];
  avoid: DOMRect | null;
}

let seed = 11;
const rnd = () => {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
};
const SPECKS = Array.from({ length: 220 }, () => ({ a: rnd() * TAU, f: rnd(), s: rnd() < 0.1 ? 1.5 : 0.9, o: 0.2 + rnd() * 0.5 }));

function ring(g: CanvasRenderingContext2D, cx: number, cy: number, r0: number, r1: number): void {
  g.beginPath();
  g.arc(cx, cy, r1, 0, TAU);
  g.arc(cx, cy, r0, 0, TAU, true);
}

function arcText(g: CanvasRenderingContext2D, s: BezelScene, text: string, r: number, mid: number, color: string, font: string, alpha: number): void {
  g.font = font;
  g.fillStyle = color;
  g.globalAlpha = alpha;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  const w = g.measureText(text).width;
  const bottom = Math.sin(mid) > 0.2;
  let x = 0;
  for (const ch of text) {
    const cw = g.measureText(ch).width;
    const off = (x + cw / 2 - w / 2) / r;
    const a = bottom ? mid - off : mid + off;
    g.save();
    g.translate(s.cx + Math.cos(a) * r, s.cy + Math.sin(a) * r);
    g.rotate(bottom ? a - Math.PI / 2 : a + Math.PI / 2);
    g.fillText(ch, 0, 0);
    g.restore();
    x += cw;
  }
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.globalAlpha = 1;
}

export function paintBezel(g: CanvasRenderingContext2D, W: number, H: number, s: BezelScene, ix: DialIndex, dial: DialMotion, col: InstrumentColors): void {
  g.clearRect(0, 0, W, H);
  if (s.open < 0.002) return;
  const L = col.light;
  const radii = bandRadii(s);
  const ro = radii[3]?.[1] ?? s.rg;
  const starC = L ? col.fg : col.star;
  const { cx, cy, rg, sc, open } = s;
  // The sky beyond the glass stays, only dimmed: the bezel is set into the galaxy.
  g.fillStyle = col.bg;
  g.globalAlpha = (L ? 0.84 : 0.78) * open;
  g.beginPath();
  g.rect(0, 0, W, H);
  g.arc(cx, cy, rg, 0, TAU, true);
  g.fill();
  g.globalAlpha = 1;
  g.save();
  if (open < 0.999) {
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, ro + 60, -Math.PI / 2 - Math.PI * open, -Math.PI / 2 + Math.PI * open);
    g.closePath();
    g.clip();
  }
  g.fillStyle = L ? 'rgba(255,255,255,0.5)' : 'rgba(3,6,15,0.72)';
  ring(g, cx, cy, rg, ro + 5 * sc);
  g.fill();
  const neb = g.createConicGradient(-Math.PI / 2, cx, cy);
  const c1 = L ? 'rgba(14,116,144,0.08)' : 'rgba(34,211,238,0.08)';
  const c2 = L ? 'rgba(109,40,217,0.07)' : 'rgba(129,140,248,0.13)';
  const c3 = L ? 'rgba(14,116,144,0.02)' : 'rgba(167,139,250,0.035)';
  [c1, c2, c3, c2, c1].forEach((c, i) => neb.addColorStop([0, 0.28, 0.52, 0.78, 1][i] ?? 0, c));
  g.fillStyle = neb;
  ring(g, cx, cy, rg, ro + 5 * sc);
  g.fill();
  g.fillStyle = starC;
  for (const p of SPECKS) {
    const r = rg + 2 + p.f * (ro - rg);
    g.globalAlpha = p.o * (L ? 0.35 : 0.55);
    g.fillRect(cx + Math.cos(p.a) * r, cy + Math.sin(p.a) * r, p.s, p.s);
  }
  g.globalAlpha = 1;
  const under = (a: number, r: number) => {
    const b = s.avoid;
    if (!b) return false;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    return x > b.left - 2 && x < b.right + 2 && y > b.top - 2 && y < b.bottom + 2;
  };
  for (let b = 0; b < 4; b += 1) {
    const [r0, r1] = radii[b] ?? [0, 0];
    const rm = (r0 + r1) / 2;
    const bw = r1 - r0;
    g.strokeStyle = L ? 'rgba(15,23,42,0.06)' : 'rgba(2,4,10,0.55)';
    g.lineWidth = bw;
    g.beginPath();
    g.arc(cx, cy, rm, 0, TAU);
    g.stroke();
    g.strokeStyle = starC;
    g.globalAlpha = L ? 0.1 : 0.09;
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, r1 + 0.5, 0, TAU);
    g.stroke();
    g.globalAlpha = 1;
    const gapA = 1.2 / rm;
    const labels: Array<{ n: DialNode; a0: number; a1: number; len: number; path: boolean; child: boolean; hov: boolean }> = [];
    const glow: Array<[number, number, string]> = [];
    for (const n of ix.bands[b] as DialNode[]) {
      const sp = ix.span.get(n);
      if (!sp) continue;
      const a0 = dial.angle(sp[0]) * DEG;
      const a1 = a0 + dial.sweep(sp) * DEG;
      const len = (a1 - a0) * rm;
      if (len < 0.9) continue;
      const path = s.focusPath.has(n);
      const child = s.childOf(n);
      const hov = s.hover === n;
      let color = starC;
      let alpha = 0.1;
      if (child) alpha = L ? 0.2 : 0.22;
      if (n.kind === 'subject' && n.mark !== 'none') {
        color = n.mark === 'approved' ? col.ok : n.mark === 'rejected' ? col.err : col.warn;
        alpha = L ? 0.55 : 0.62;
      }
      if (s.lit && n.kind === 'subject' && s.lit.has(n.slug)) {
        color = col.accent;
        alpha = 0.85;
      }
      if (hov) {
        color = col.accent;
        alpha = L ? 0.3 : 0.38;
      }
      if (path) {
        color = n === s.pinned ? col.purple : col.accent;
        alpha = L ? 0.2 : 0.26;
        glow.push([a0, a1, color]);
      }
      g.strokeStyle = color;
      g.globalAlpha = alpha;
      g.lineWidth = bw;
      const gp = len > 4 ? gapA : 0;
      g.beginPath();
      g.arc(cx, cy, rm, a0 + gp / 2, a1 - gp / 2);
      g.stroke();
      if (child && len > 4 && !L) {
        g.globalAlpha = 0.45;
        g.lineWidth = 1;
        g.beginPath();
        g.arc(cx, cy, r1 - 0.5, a0 + gp / 2, a1 - gp / 2);
        g.stroke();
      }
      if (bw >= 13) labels.push({ n, a0, a1, len, path, child, hov });
    }
    for (const [a0, a1, c] of glow) {
      g.strokeStyle = c;
      g.lineWidth = 1.5;
      if (!L) {
        g.shadowColor = c;
        g.shadowBlur = 6;
      }
      g.globalAlpha = 0.85;
      g.beginPath();
      g.arc(cx, cy, r1 - 0.8, a0 + gapA / 2, a1 - gapA / 2);
      g.stroke();
      g.shadowBlur = 0;
      g.globalAlpha = 0.35;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(cx, cy, r0 + 0.6, a0 + gapA / 2, a1 - gapA / 2);
      g.stroke();
    }
    g.globalAlpha = 1;
    // Arc labels where they fit, at 13 to 16 px; the band you choose from
    // also carries the rank number.
    for (const lb of labels) {
      const big = bw > 18;
      const font = `${lb.path ? 700 : 600} ${big ? Math.round(14 * Math.min(1.15, Math.max(1, sc))) : 13}px ${col.font}`;
      g.font = font;
      let t = lb.child ? `${lb.n.rank}  ${nodeTitle(lb.n)}` : nodeTitle(lb.n);
      let tw = g.measureText(t).width;
      if (tw + 14 > lb.len) {
        t = lb.child ? String(lb.n.rank) : '';
        tw = g.measureText(t).width;
        if (!t || tw + 8 > lb.len) continue;
      }
      const mid = (lb.a0 + lb.a1) / 2;
      if (under(mid, rm)) continue;
      const lit = lb.path || lb.hov;
      arcText(g, s, t, rm, mid, lit ? col.fg : lb.child ? starC : col.muted, font, lit ? 1 : lb.child ? 0.92 : 0.8);
    }
  }
  paintRim(g, s, ro, col);
  paintBlips(g, s, ro, ix, dial, col);
  g.restore();
  // The lubber mark: 12 o'clock is always where you are.
  if (!L) {
    g.shadowColor = col.accent;
    g.shadowBlur = 10;
  }
  g.globalAlpha = open;
  g.fillStyle = col.accent;
  g.beginPath();
  g.moveTo(cx, cy - rg + 2);
  g.lineTo(cx - 7, cy - rg - 8);
  g.lineTo(cx + 7, cy - rg - 8);
  g.closePath();
  g.fill();
  g.shadowBlur = 0;
  g.globalAlpha = 1;
}
