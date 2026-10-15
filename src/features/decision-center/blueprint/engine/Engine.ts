// The blueprint's canvas engine (PORTED from bp src/engine/Engine.ts via the r3-r2 prototype). It owns one canvas
// the page hands it, the camera, the colour theme and the frame loop; the draw passes live in plan.ts, labels.ts,
// tiles.ts, pins.ts and flags.ts and read their state from here. Nothing in this module touches IPC or React.
import type { Feature } from '../standard/load';
import type { Plan } from '../model/plan';
import type { Work, WorkItem } from '../model/work';
import type { TileNode, RoomNode } from '../model/layout';
import { Camera, PADS, type Pad } from './camera';
import { readTheme, type CanvasTheme } from './theme';
import { makeText, type PlanText } from './text';
import { buildWalls, drawBuildings, drawGrid, type Walls } from './plan';
import { drawLabels } from './labels';
import { drawFocus, drawPins } from './pins';
import { drawFlags, flagAt, layoutFlags } from './flags';
import { tileAt, roomAt } from './hit';
import { wireInput } from './input';
import type { EngineWords, FlagBox, Focus, Hooks } from './types';

export interface Mix { top: string | null; p(lens: string): 0 | 1 }
const EMPTY_WORK: Work = { items: [], byId: new Map(), byFeature: new Map(), packs: [], runs: [], lastRun: null, activeRuns: 0, series: () => [], evidence: () => [], packFlow: false };

export class Engine {
  readonly cv: HTMLCanvasElement;
  readonly host: HTMLElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly cam: Camera;
  th: CanvasTheme;
  tx: PlanText;
  plan: Plan;
  work: Work = EMPTY_WORK;
  words: EngineWords;
  walls: Walls;
  /** 'general' shows every lens; a lens id shows only its own. */
  lens = 'general';
  hot: string | null = null;
  hotFlag: string | null = null;
  focus: Focus | null = null;
  flags: FlagBox[] = [];
  /** How many feature names the last frame drew, of how many tiles it considered (the level bar's NAMES cell). */
  budget = { names: 0, of: 0 };
  dirty = true;
  mixS: Mix = { top: null, p: () => 1 };
  readonly hooks: Hooks;
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private placed = false;
  private off: () => void;

  constructor(cv: HTMLCanvasElement, host: HTMLElement, plan: Plan, words: EngineWords, hooks: Hooks) {
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('blueprint: no 2d canvas');
    this.cv = cv; this.host = host; this.ctx = ctx; this.hooks = hooks; this.plan = plan; this.words = words;
    this.cam = new Camera(plan.L);
    this.th = readTheme(host);
    this.tx = makeText(ctx, this.th.sans, this.th.mono);
    this.walls = buildWalls(plan.L);
    const loop = (now: number) => { this.tick(now); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
    if (typeof ResizeObserver === 'function') { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host); }
    this.off = wireInput(this);
    this.resize();
  }

  dispose(): void { cancelAnimationFrame(this.raf); this.ro?.disconnect(); this.off(); }

  retheme(): void { this.th = readTheme(this.host); this.tx = makeText(this.ctx, this.th.sans, this.th.mono); this.dirty = true; }
  setWords(w: EngineWords): void { this.words = w; this.dirty = true; }
  setWork(w: Work): void { this.work = w; this.dirty = true; }
  setLens(id: string): void { this.lens = id; this.dirty = true; }
  setFocus(f: Focus | null): void { this.focus = f; this.dirty = true; }
  /** A new plan (another product, or its map changed): the camera re-fits. */
  setPlan(plan: Plan): void {
    this.plan = plan; this.placed = false; this.focus = null; this.walls = buildWalls(plan.L);
    this.cam.setLayout(plan.L); this.resize();
  }

  resize(): void {
    const r = this.host.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const w = Math.max(200, r.width), h = Math.max(200, r.height);
    this.cv.width = Math.round(w * d); this.cv.height = Math.round(h * d);
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
    this.cam.resize(w, h, this.hooks.safe(), !this.placed);
    this.placed = true; this.dirty = true;
  }

  // ---------------------------------------------------------------- what the draw passes ask of the engine
  pad(kind: 'bld' | 'wing' | 'room' | 'bay'): Pad { return PADS[kind]; }
  mix(): Mix { const top = this.lens === 'general' ? null : this.lens; return { top, p: (l) => (top === null || l === top ? 1 : 0) }; }
  /** The work still the operator's: proposed (waiting) and approved (not built). */
  waitingOf(f: Feature): WorkItem[] {
    return (this.work.byFeature.get(f.id) ?? []).filter((p) => p.status === 'proposed' || p.status === 'approved');
  }
  accentOf(lens: string): string {
    const L = this.plan.LENS[lens];
    return L?.accent ? (this.th.mode === 'light' ? L.accent.light : L.accent.dark) : this.th.accent;
  }
  onView(r: { x: number; y: number; w: number; h: number }, m = 0): boolean { return !(r.x > this.cam.FW + m || r.y > this.cam.FH + m || r.x + r.w < -m || r.y + r.h < -m); }
  /** A fixture's screen rect: its tile at fixture scale, its ribbon segment above it. */
  featRect(fid: string, lod: number): { x: number; y: number; w: number; h: number } | null {
    const T = this.plan.L.TILE[fid];
    if (!T) return null;
    if (lod > 0.5) return this.cam.rs(T);
    const rb = T.bay.rib, n = T.bay.tiles.length, sw = rb.w * this.cam.k / n;
    return { x: this.cam.sx(rb.x) + T.bi * sw, y: this.cam.sy(rb.y), w: sw, h: rb.h * this.cam.k };
  }
  tileAt(px: number, py: number): TileNode | null { return tileAt(this, px, py); }
  roomAt(px: number, py: number): RoomNode | null { return roomAt(this, px, py); }
  flagAt(px: number, py: number): FlagBox | null { return flagAt(this.flags, px, py); }

  // ---------------------------------------------------------------- the frame
  private tick(now: number): void {
    if (this.cam.step(now) || this.cam.moved) { this.dirty = true; this.cam.moved = false; }
    if (this.focus && !this.cam.reduced()) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.draw(now);
    this.hooks.moved();
  }
  private draw(now: number): void {
    const { ctx, th, cam } = this;
    ctx.fillStyle = th.paper; ctx.fillRect(0, 0, cam.FW, cam.FH);
    this.mixS = this.mix();
    drawGrid(this, ctx);
    this.budget = { names: 0, of: 0 };
    drawBuildings(this, ctx);
    drawLabels(this, ctx);
    drawPins(this, ctx, now);
    drawFocus(this, ctx, now);
    this.flags = layoutFlags(this);
    drawFlags(this, ctx);
  }
}
