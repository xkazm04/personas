import type { Fates } from './fates';
import type { Geo } from './geometry';
import { cubicAt, hash, smooth, type Pt } from './noise';
import type { Ink } from './useStageEnv';

interface Speck { lane: number; q: number | null; speed: number; phase: 0 | 1; x: number; u: number; jit: number; xEnd: number; cur: [Pt, Pt, Pt, Pt]; blen: number; col: string }

/** How long the water keeps moving after the last sign of a reader, ms. */
const IDLE_MS = 45_000;

/**
 * The map's moving water, on one canvas in one rAF loop: a soft speck per real session drifting
 * downstream in its own conserved lane and peeling off into its marsh, lake or delta mouth, plus
 * the current along the river's centre. The loop stops when the reader is idle, when the document
 * is hidden and under reduced motion; `wake()` restarts it. Nothing here touches React.
 */
export class FlowEngine {
  private ctx: CanvasRenderingContext2D | null;
  private parts: Speck[] = [];
  private sprites = new Map<string, HTMLCanvasElement>();
  private g: Geo | null = null;
  private ink: Ink | null = null;
  private mid: Path2D | null = null;
  private raf = 0;
  private last = 0;
  private until = 0;
  private dpr = 1;
  private zoom = 1;
  private hiddenUntil = 0;
  focus: number | null = null;
  deep = false;
  reduce = false;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  /** A new map (mode, repository or size). `delayMs` holds the specks back while the river fills. */
  setScene(g: Geo, f: Fates, ids: string[], ink: Ink, midline: Pt[], delayMs: number) {
    this.g = g;
    this.ink = ink;
    this.sprites.clear();
    this.mid = new Path2D(midline.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(''));
    this.hiddenUntil = performance.now() + delayMs;
    this.parts = this.reduce ? [] : buildSpecks(g, f, ids, ink);
    this.resize();
    this.wake();
  }

  /** The arrival was skipped: let the water show now. */
  showNow() {
    this.hiddenUntil = 0;
    this.wake();
  }

  setZoom(s: number) {
    this.zoom = Math.max(1, s);
    this.resize();
  }

  private resize() {
    if (!this.g) return;
    this.dpr = Math.min(3, (window.devicePixelRatio || 1) * this.zoom);
    this.canvas.width = Math.round(this.g.W * this.dpr);
    this.canvas.height = Math.round(this.g.H * this.dpr);
    this.canvas.style.width = `${this.g.W}px`;
    this.canvas.style.height = `${this.g.H}px`;
    if (!this.raf) this.draw(performance.now());
  }

  /** Any sign of a reader: keep the water moving for a while. */
  wake() {
    this.until = performance.now() + IDLE_MS;
    if (!this.raf && !this.reduce && !document.hidden) { this.last = 0; this.raf = requestAnimationFrame(this.frame); }
  }

  private onVisibility = () => {
    if (document.hidden) { cancelAnimationFrame(this.raf); this.raf = 0; } else this.wake();
  };

  private frame = (now: number) => {
    this.raf = 0;
    this.draw(now);
    if (now < this.until && !this.reduce && !document.hidden) this.raf = requestAnimationFrame(this.frame);
  };

  private sprite(col: string) {
    let c = this.sprites.get(col);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = c.height = 24;
    const x = c.getContext('2d');
    if (x) {
      const gr = x.createRadialGradient(12, 12, 0, 12, 12, 12);
      gr.addColorStop(0, col);
      gr.addColorStop(0.25, col);
      gr.addColorStop(1, 'transparent');
      x.fillStyle = gr;
      x.fillRect(0, 0, 24, 24);
    }
    this.sprites.set(col, c);
    return c;
  }

  private draw(now: number) {
    const { ctx, g, ink } = this;
    if (!ctx || !g || !ink) return;
    const dt = Math.min(0.05, (now - (this.last || now)) / 1000);
    this.last = now;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.reduce || now < this.hiddenUntil) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.mid) {
      ctx.strokeStyle = ink.accent;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 14]);
      ctx.lineDashOffset = -now * 0.021;
      ctx.stroke(this.mid);
      ctx.setLineDash([]);
    }
    ctx.globalCompositeOperation = 'lighter';
    const pale = this.sprite(ink.fg);
    const focus = this.deep ? null : this.focus;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i]!;
      let x: number, y: number, a: number, spr = pale, size = 5.5 * g.U;
      if (p.phase === 0) {
        p.x += p.speed * dt;
        if (p.x >= p.xEnd) { p.phase = 1; p.u = 0; }
        if (p.x < g.xA) continue;
        x = p.x;
        y = g.laneY(p.lane, x) + Math.sin(now / 900 + p.jit * 20) * g.k * 0.3;
        a = Math.min(1, (p.x - g.xA) / 40) * 0.42;
      } else {
        p.u += (p.speed * dt) / p.blen;
        if (p.u >= 1) { p.phase = 0; p.x = g.xA - hash(i, Math.floor(now) % 97, 8) * (g.xB - g.xA) * 0.5; continue; }
        [x, y] = cubicAt(p.cur[0], p.cur[1], p.cur[2], p.cur[3], smooth(p.u) * 0.5 + p.u * 0.5);
        spr = this.sprite(p.col);
        a = 0.75 * (1 - Math.max(0, (p.u - 0.6) / 0.4));
        size = 6.5 * g.U;
      }
      if (this.deep) a *= 0.25;
      else if (focus != null) a *= p.q === focus ? 1.4 : 0.35;
      ctx.globalAlpha = Math.max(0, Math.min(1, a));
      ctx.drawImage(spr, x - size / 2, y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

function buildSpecks(g: Geo, f: Fates, ids: string[], ink: Ink): Speck[] {
  const blobBy = new Map(g.blobs.map((b) => [b.type + b.q, b]));
  const mouthBy = new Map(g.mouths.map((m) => [m.o, m]));
  const out: Speck[] = [];
  ids.forEach((id, i) => {
    const fate = f.fate.get(id), lane = f.lanes.get(id);
    if (!fate || lane == null) return;
    const base = { lane, speed: (52 + hash(i, 1, 2) * 40) * g.U, phase: 0 as const, u: 0, jit: hash(i, 7, 3) };
    let cur: [Pt, Pt, Pt, Pt], xEnd: number, col: string, q: number | null = null;
    if (fate.type === 'sea') {
      const mo = mouthBy.get(fate.o)!, fr = mo.cnt ? (lane - f.seaStart[fate.o] + 0.5) / mo.cnt : 0.5;
      const y0 = g.laneY(lane, g.xB), y1 = mo.ys - mo.w / 2 + fr * mo.w, c = (g.xM - g.xB) * 0.55;
      xEnd = g.xB;
      cur = [[g.xB, y0], [g.xB + c, y0], [g.xM - c, y1], [g.xM + 40 * g.U, y1 + (fr - 0.5) * 30 * g.U]];
      col = fate.o === 'landed' ? ink.accent : fate.o === 'quiet' ? ink.mfg : ink.err;
    } else {
      const b = blobBy.get(fate.type + fate.q);
      if (!b) return;
      const x0 = g.dx[fate.q]!, yl = g.laneY(lane, x0);
      const ang = hash(i, 9, 4) * Math.PI * 2, rr = Math.sqrt(hash(i, 11, 4)) * 0.75;
      xEnd = x0;
      cur = [[x0, yl], [x0 + 0.18 * g.sp, yl], b.p2, [b.cx + Math.cos(ang) * b.rx * rr, b.cy + Math.sin(ang) * b.ry * rr]];
      col = fate.type === 'marsh' ? ink.err : ink.muted;
      q = fate.q;
    }
    const blen = Math.hypot(cur[3][0] - cur[0][0], cur[3][1] - cur[0][1]) * 1.25 + 20;
    const x = g.xA + hash(i, 13, 5) * (xEnd - g.xA) - hash(i, 17, 6) * (g.xB - g.xA) * 0.6;
    out.push({ ...base, q, x, xEnd, cur, blen, col });
  });
  return out;
}
