// The blueprint's canvas engine (PORTED from bp src/engine/Engine.ts: its frame, its static raster cache and its
// dynamic layers). It owns one canvas the page hands it, the camera, the colour theme and the frame loop. The plan
// (grid, walls, fixtures, labels) is rastered once into an offscreen bitmap (static-cache.ts) and only transformed
// while the camera moves, re-rastered when it settles; pins, hover, selection, the current item and the trouble
// flags draw over it at the live camera every frame. The canvas is TRANSPARENT: the paper is the CSS ground under it
// (theme/ground.css), as in bp. Nothing in this module touches IPC or React.
// EDIT (port): bp's simulation, scans, lasso, intro, phone layout, UI scale U and its spring-tweened lens mix are
// not brought (no data for them here, or the page owns them); the lens switches at once. Time travel (bp S.t), the
// recent window (bp S.delta, here the rail's View days) and the picked items' rings (bp drawTargets) are (Stage D).
import type { Feature, Stage } from '../standard/load';
import type { Scalar } from '../standard/types';
import type { Plan } from '../model/plan';
import type { Work, WorkItem } from '../model/work';
import type { TileNode, RoomNode } from '../model/layout';
import { Camera, PADS, type Pad } from './camera';
import { readTheme, type CanvasTheme } from './theme';
import { PlanText, watchFonts } from './text';
import { buildWalls, drawBuildings, drawGrid, featRect, type Walls } from './plan';
import { drawLabels } from './labels';
import { drawFocus, drawOverlays, drawPins, drawTargets } from './pins';
import { Flashes, drawChanged } from './changed';
import { stageOfAt } from './travel';
import { drawFlags, flagAt, layoutFlags } from './flags';
import { tileAt, roomAt } from './hit';
import { wireInput } from './input';
import { StaticCache, deviceRes } from './static-cache';
import type { FeatureLive } from './lens';
import type { View } from './view';
import type { EngineWords, FlagBox, Focus, Hooks } from './types';

/** The lens mix (bp lens/mix.ts, at rest): which lens dominates, and each lens's presence and expansion. */
export interface Mix { top: string | null; p(lens: string): 0 | 1; x(lens: string): 0 | 1 }
const EMPTY_WORK: Work = { items: [], byId: new Map(), byFeature: new Map(), packs: [], runs: [], lastRun: null, activeRuns: 0, series: () => [], evidence: () => [], packFlow: false };
/** bp sim.ts SIM_FIELDS: where the map keeps a feature's rollout and its build progress. */
const ROLLOUT = ['operations', 'rolloutPct'] as const, PROGRESS = ['development', 'progressPct'] as const;
const num = (f: Feature, lens: string, key: string): number | null => { const v = f.lens[lens]?.v[key]; return typeof v === 'number' ? v : null; };
/** The camera rests this long (ms) before the moved raster is redrawn sharp (bp's settle window). */
const SETTLE_MS = 140;

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
  /** Stage D: the date drawn at (null = now), the recent window in days (the View), the picked items and their features. */
  at: string | null = null; viewDays = 7; picked: readonly string[] = []; pickedF: ReadonlySet<string> = new Set();
  hot: string | null = null;
  hotFlag: string | null = null;
  focus: Focus | null = null;
  flags: FlagBox[] = [];
  /** How many feature names the last raster drew, of how many tiles it considered (the level bar's NAMES cell). */
  budget = { names: 0, of: 0 };
  dirty = true;
  mixS: Mix = { top: null, p: () => 1, x: () => 0 };
  readonly hooks: Hooks;
  /** The one-shot marks of features that just changed; the frame loop runs for them only while they decay. */
  readonly flashes = new Flashes();
  private cache = new StaticCache();
  private ver = 0;
  private RES = 1;
  private lastCamMove = 0;
  private settlePending = false;
  private sig = { x: NaN, y: NaN, k: NaN };
  private raf = 0;
  private ro: ResizeObserver | null = null;
  private placed = false;
  private off: () => void;
  private offFonts: () => void;
  private liveRec = { rolloutPct: 0, progressPct: 0, f: null as Feature | null };
  private liveView: FeatureLive;

  constructor(cv: HTMLCanvasElement, host: HTMLElement, plan: Plan, words: EngineWords, hooks: Hooks) {
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('blueprint: no 2d canvas');
    this.cv = cv; this.host = host; this.ctx = ctx; this.hooks = hooks; this.plan = plan; this.words = words;
    this.cam = new Camera(plan.L);
    this.RES = deviceRes(1, 1, window.devicePixelRatio);
    this.th = readTheme(host, this.RES);
    this.tx = new PlanText(this.th.sans, this.th.mono);
    this.walls = buildWalls(plan.L);
    const rec = this.liveRec;
    this.liveView = {
      get rolloutPct() { return rec.rolloutPct; },
      get progressPct() { return rec.progressPct; },
      value: (lens: string, key: string): Scalar | undefined => rec.f?.lens[lens]?.v[key],
    };
    const loop = (now: number) => { this.tick(now); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
    if (typeof ResizeObserver === 'function') { this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host); }
    this.off = wireInput(this);
    this.offFonts = watchFonts(this.th, () => { this.tx.clear(); this.bump(); });
    this.resize();
    this.syncLens();
  }

  dispose(): void { cancelAnimationFrame(this.raf); this.ro?.disconnect(); this.off(); this.offFonts(); }

  /** The static raster's content changed: re-raster on the next frame. */
  private bump(): void { this.ver++; this.dirty = true; }
  retheme(): void { this.th = readTheme(this.host, this.RES); this.tx.setFamilies(this.th.sans, this.th.mono); this.syncLens(); this.bump(); }
  setWords(w: EngineWords): void { this.words = w; this.bump(); }
  setWork(w: Work): void { this.work = w; this.setPicked(this.picked); this.bump(); }
  setLens(id: string): void { this.lens = id; this.syncLens(); this.bump(); }
  /** Mark these features as changed: a short highlight that fades and then lets the canvas go idle. */
  flash(fids: Iterable<string>): void { this.flashes.add(fids); this.dirty = true; }
  setFocus(f: Focus | null): void { this.focus = f; this.dirty = true; }
  setAt(d: string | null): void { if (d !== this.at) { this.at = d; this.bump(); } }
  setViewDays(n: number): void { if (n !== this.viewDays) { this.viewDays = n; this.bump(); } }
  setPicked(ids: readonly string[]): void { this.picked = ids; this.pickedF = new Set(ids.map((id) => this.work.byId.get(id)?.fid ?? '')); this.dirty = true; }
  /** Drawn as it stands now (bp isNow): trouble, verdicts, pins and live values speak of now only. `day`: the date drawn. */
  get isNow(): boolean { return this.at === null || this.at >= this.plan.S.asOf; }
  get day(): string { return this.at ?? this.plan.S.asOf; }
  /** A feature's stage on the drawn date (replayed from the events log while travelled). */
  stageOf(f: Feature): Stage | null { return stageOfAt(f, this.at, this.plan.S.asOf); }
  /** A new plan (another product, or its map changed): the camera re-fits. */
  setPlan(plan: Plan): void {
    this.plan = plan; this.placed = false; this.focus = null; this.walls = buildWalls(plan.L);
    this.cam.setLayout(plan.L); this.resize(); this.syncLens(); this.bump();
  }

  /** bp syncRootView: the sheet root carries the active lens's accent as `--bp-lens` (ink in General). */
  private syncLens(): void {
    const root = this.host.closest<HTMLElement>('.bp-root') ?? this.host;
    root.style.setProperty('--bp-lens', this.lens === 'general' ? 'var(--bp-ink)' : this.lensAccent(this.lens));
  }

  resize(): void {
    const r = this.host.getBoundingClientRect(), w = Math.max(200, r.width), h = Math.max(200, r.height);
    const res = deviceRes(w, h, window.devicePixelRatio);
    if (Math.abs(res - this.RES) > 1e-3) { this.RES = res; this.th = readTheme(this.host, res); this.tx.setFamilies(this.th.sans, this.th.mono); }
    this.cv.width = Math.round(w * res); this.cv.height = Math.round(h * res);
    this.cv.style.width = w + 'px'; this.cv.style.height = h + 'px';
    this.cam.resize(w, h, this.hooks.safe(), !this.placed);
    this.placed = true; this.cache.invalidate(); this.bump();
  }

  // ---------------------------------------------------------------- what the draw passes ask of the engine
  pad(kind: 'bld' | 'wing' | 'room' | 'bay'): Pad { return PADS[kind]; }
  mix(): Mix {
    const top = this.lens === 'general' ? null : this.lens;
    return { top, p: (l) => (top === null || l === top ? 1 : 0), x: (l) => (top !== null && l === top ? 1 : 0) };
  }
  /** A feature's live values; the returned record is reused: read it before the next call. */
  live(f: Feature): FeatureLive {
    const r = this.liveRec, st = this.stageOf(f), live = st === 'live' || st === 'flagged', now = this.isNow;
    r.f = f; r.rolloutPct = (now ? num(f, ...ROLLOUT) : null) ?? (live ? 100 : 0); r.progressPct = (now ? num(f, ...PROGRESS) : null) ?? 0;
    return this.liveView;
  }
  /** The work still the operator's: proposed (waiting) and approved (not built). */
  waitingOf(f: Feature): WorkItem[] {
    return (this.work.byFeature.get(f.id) ?? []).filter((p) => p.status === 'proposed' || p.status === 'approved');
  }
  /** Room pins stand on the plan (bp: while its simulation runs; here: while any work waits): room labels keep clear of them. */
  pinsDrawn(): boolean { return this.isNow && this.work.items.some((p) => p.status === 'proposed' || p.status === 'approved'); }
  /** The colour a lens's words take on the plan. bp's adopted expression (subtle) gives no lens its own: ink. */
  accentOf(_lens: string | null): string { return this.th.ink; }
  /** A lens's manifest accent (`presentation.accent`), else ink: the chrome's `--bp-lens`. */
  lensAccent(lens: string): string {
    const a = this.plan.LENS[lens]?.accent;
    return a ? (this.th.mode === 'light' ? a.light : a.dark) : 'var(--bp-ink)';
  }
  /** The live camera's view (cull bounds = the screen). */
  get view(): View { const c = this.cam; return { x: c.x, y: c.y, k: c.k, FW: c.FW, FH: c.FH, c0x: 0, c0y: 0, c1x: c.FW, c1y: c.FH }; }
  /** A fixture's screen rect: its tile at fixture scale, its ribbon segment above it. */
  featRect(fid: string, lod: number): { x: number; y: number; w: number; h: number } | null { return featRect(this, this.view, fid, lod); }
  tileAt(px: number, py: number): TileNode | null { return tileAt(this, px, py); }
  roomAt(px: number, py: number): RoomNode | null { return roomAt(this, px, py); }
  flagAt(px: number, py: number): FlagBox | null { return flagAt(this.flags, px, py); }

  // ---------------------------------------------------------------- the frame
  private tick(now: number): void {
    const c = this.cam, s = this.sig;
    if (c.step(now) || c.moved) { this.dirty = true; c.moved = false; }
    if (c.x !== s.x || c.y !== s.y || c.k !== s.k) { s.x = c.x; s.y = c.y; s.k = c.k; this.lastCamMove = now; this.dirty = true; }
    if ((this.focus || this.pickedF.size) && !c.reduced()) this.dirty = true;
    if (this.flashes.step(now)) this.dirty = true;
    if (this.settlePending && now - this.lastCamMove > SETTLE_MS) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.draw(now);
    this.hooks.moved();
  }
  private draw(now: number): void {
    const { ctx, cam } = this, FW = cam.FW, FH = cam.FH;
    ctx.setTransform(this.RES, 0, 0, this.RES, 0, 0);
    ctx.clearRect(0, 0, FW, FH);
    this.mixS = this.mix();
    const lod = cam.lod(), st = this.cache.check(cam, this.ver, FW, FH, lod);
    const gesture = !!cam.anim || now - this.lastCamMove <= SETTLE_MS;
    if (st === 'stale' || (st === 'transform' && !gesture)) {
      this.cache.render(cam, this.ver, FW, FH, this.RES, (g, v) => this.paintPlan(g, v), undefined, lod);
      this.settlePending = false;
    } else if (st === 'transform') this.settlePending = true;
    this.cache.draw(ctx, cam, undefined, this.RES);
    const v = this.view;
    drawTargets(this, ctx, v, lod);
    drawChanged(this, ctx, v, lod, now);
    drawOverlays(this, ctx, v, lod, now);
    if (this.isNow) drawPins(this, ctx, v, lod, now);
    drawFocus(this, ctx, v, lod, now);
    // trouble flags over everything: the first thing to find on the plan (they speak of now: none on a past date)
    this.flags = this.isNow ? layoutFlags(this, v, lod) : [];
    drawFlags(this, ctx, this.flags, this.hotFlag);
  }
  /** The whole static plan at raster view `v`. */
  private paintPlan(g: CanvasRenderingContext2D, v: View): void {
    this.th.anchor(v.FW / 2 - v.x * v.k, v.FH / 2 - v.y * v.k);
    this.budget = { names: 0, of: 0 };
    drawGrid(this, g, v); drawBuildings(this, g, v); drawLabels(this, g, v);
  }
}
