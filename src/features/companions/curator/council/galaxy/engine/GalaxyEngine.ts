// The galaxy engine — one class, owned by a ref, never a React component.
//
// Drawing happens ON DEMAND: `invalidate()` schedules exactly one frame, a
// flight runs its own tween and then stops. With nothing moving the engine
// calls `requestAnimationFrame` zero times, which is the property the
// reference artifact holds and the one a `useEffect`-driven redraw destroys.
//
// Input follows this repo's rules rather than the prototype's: the wheel is a
// NATIVE non-passive listener (a React `onWheel` cannot `preventDefault`), and
// panning uses element pointer capture rather than a document-scoped move loop
// (precedent: `sub_mastermind/lib/useCanvasCamera.ts:141-215`).
import {
  categoryScale,
  domainScale,
  easeStandard,
  fitToSet,
  MAX_SCALE,
  skyScale,
  subjectScale,
  tweenCamera,
  viewportCentre,
  type Viewport,
} from './camera';
import { LabelQueue, type Rect } from './labels';
import type { Circle, LabelWindow } from './labelsFused';
import type { StyleProfile } from './profile';
import { LENS_R, type LensState } from './lens';
import { paintFrame, type CanvasCaptions } from './paint';
import type { PickTarget } from './types';
import type { CanvasTheme } from './theme';
import type {
  Altitude,
  CameraState,
  CategoryNode,
  DomainNode,
  GalaxyCounts,
  GalaxyFocus,
  GalaxyLayout,
  GalaxyNode,
  SubjectNode,
  TechniqueNode,
} from './types';

/**
 * Space the fused HUD's chrome takes from the field, in stage pixels: the
 * left column, the technique document on the right, the dock at the bottom.
 * All zero for the classic stage, whose viewport is then exactly what it was.
 */
export interface StageInsets {
  l: number;
  r: number;
  b: number;
}

const NO_INSETS: StageInsets = { l: 0, r: 0, b: 0 };

/** Where the reader stands, as nodes rather than slugs. */
export interface EnginePath {
  domain: DomainNode | null;
  category: CategoryNode | null;
  subject: SubjectNode | null;
  technique: TechniqueNode | null;
}

export interface EngineCallbacks {
  /** The reader moved: the rail and the breadcrumb follow this, not the camera. */
  onFocusChange: (focus: GalaxyFocus) => void;
  onHoverChange: (node: GalaxyNode | null) => void;
  onCounts: (counts: GalaxyCounts) => void;
  /**
   * Screen-space anchor for the hover card, or null to hide it. `pinned` is
   * true for the card a CLICK on a technique left standing: a technique has
   * no layer under it, so the click that would descend opens its card and
   * keeps it open until Escape.
   */
  onPointerTarget: (target: { node: GalaxyNode; x: number; y: number; pinned: boolean } | null) => void;
}

/**
 * Every flight in this layer, in milliseconds.
 *
 * `--duration-slow`, the app's rung for a page transition or a large reveal
 * (`Design.md` section 6), paired with the app's one easing curve in
 * `camera.ts`. The descent used to run 700 ms on a curve of its own while the
 * rail beside it flipped on the app's 250 ms one, so the list landed well
 * before the camera it was supposed to arrive with.
 */
const FLIGHT_MS = 400;

/** A press-and-release inside this many pixels of movement is a CLICK. */
const CLICK_SLOP = 4;

interface CameraFrame extends CameraState {
  focus: GalaxyFocus;
}

const DPR_CAP = 2;

export class GalaxyEngine {
  private canvas: HTMLCanvasElement | null = null;

  private ctx: CanvasRenderingContext2D | null = null;

  private observer: ResizeObserver | null = null;

  private layout: GalaxyLayout | null = null;

  private theme: CanvasTheme | null = null;

  private captions: CanvasCaptions;

  private readonly callbacks: EngineCallbacks;

  private camera: CameraState = { x: 0, y: 0, k: 0.3 };

  private width = 0;

  private height = 0;

  private dpr = 1;

  private benchHeight = 0;

  private focus: GalaxyFocus = { kind: 'none' };

  private domain: DomainNode | null = null;

  private category: CategoryNode | null = null;

  private subject: SubjectNode | null = null;

  private thread: Set<string> | null = null;

  private hover: GalaxyNode | null = null;

  private lens: LensState = { on: true, x: null, y: null };

  private labels = new LabelQueue();

  private picks: PickTarget[] = [];

  private reserved: Rect[] = [];

  private labelsHidden = 0;

  /** `profile.ts`. Classic unless a host asks for the fused field. */
  private profile: StyleProfile = 'classic';

  /** Fused only: the nodes drawn this frame, which labels may not cover. */
  private readonly obstacles: Circle[] = [];

  /** Fused only: the bezel's glass, when the field is framed inside it. */
  private labelWindow: LabelWindow | null = null;

  // ── the fused stage's seams (all inert for the classic stage) ────────────

  /** The insets as drawn this frame; they ease on the flight's own curve. */
  private insets: StageInsets = NO_INSETS;

  private insetsTo: StageInsets | null = null;

  /**
   * How much of the usual frame a focus may fill, per level (0 sky .. 3
   * subject). The bezel frames the field inside its glass with this. Null
   * is 1 everywhere, which is the classic stage.
   */
  private frameFill: ((level: number, v: Viewport) => number) | null = null;

  private readonly frameListeners = new Set<() => void>();

  /** Eased progress of the current flight, 1 at rest; the id moves per flight. */
  private flightE = 1;

  private flightId = 0;

  private altitudeFrom = 0;

  private altitudeTo = 0;

  private altitudeNow = 0;

  /** Fused only: the reader asked for reduced motion, so flights land at once. */
  private reduceMotion = false;

  private frame = 0;

  private flight = 0;

  private dirty = false;

  private drag: { id: number; sx: number; sy: number; cx: number; cy: number; moved: number } | null = null;

  /**
   * The hover card a click on a TECHNIQUE left standing.
   *
   * Frozen at the moment of the click rather than recomputed: nothing that
   * can move the card (a wheel, a drag, a flight) survives the pin, so the
   * anchor it was pinned at is the anchor it still has.
   */
  private pinned: { node: GalaxyNode; x: number; y: number } | null = null;

  constructor(callbacks: EngineCallbacks, captions: CanvasCaptions) {
    this.callbacks = callbacks;
    this.captions = captions;
  }

  // ── lifecycle ────────────────────────────────────────────────────────────

  mount(canvas: HTMLCanvasElement): void {
    if (this.canvas === canvas) return;
    this.destroy();
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('lostpointercapture', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('click', this.onClick);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas);
    this.resize();
  }

  destroy(): void {
    const canvas = this.canvas;
    if (canvas) {
      canvas.removeEventListener('wheel', this.onWheel);
      canvas.removeEventListener('pointerdown', this.onPointerDown);
      canvas.removeEventListener('pointermove', this.onPointerMove);
      canvas.removeEventListener('pointerup', this.onPointerUp);
      canvas.removeEventListener('pointercancel', this.onPointerUp);
      canvas.removeEventListener('lostpointercapture', this.onPointerUp);
      canvas.removeEventListener('pointerleave', this.onPointerLeave);
      canvas.removeEventListener('click', this.onClick);
    }
    this.observer?.disconnect();
    this.observer = null;
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.flight) cancelAnimationFrame(this.flight);
    this.frame = 0;
    this.flight = 0;
    this.dirty = false;
    this.drag = null;
    this.canvas = null;
    this.ctx = null;
  }

  // ── inputs from React ────────────────────────────────────────────────────

  setCaptions(captions: CanvasCaptions): void {
    this.captions = captions;
    this.invalidate();
  }

  setTheme(theme: CanvasTheme): void {
    this.theme = theme;
    this.invalidate();
  }

  setData(layout: GalaxyLayout | null): void {
    this.layout = layout;
    this.domain = null;
    this.category = null;
    this.subject = null;
    this.stack.length = 0;
    if (layout) {
      this.applyFocus(this.focus, false);
      this.camera = { x: 0, y: 0, k: this.skyK() * 0.28 };
      this.flyTo({ x: 0, y: 0, k: this.skyK() }, 1500);
    }
    this.invalidate();
  }

  /** WP8's seam: the bench eats the bottom of the stage without hiding it. */
  setBenchHeight(px: number): void {
    if (this.benchHeight === px) return;
    this.benchHeight = px;
    this.invalidate();
  }

  /**
   * The HUD cards are opaque, so the occupancy pass has to know where they
   * are: a caption laid under one is hidden by furniture, not by density.
   * Rects are in stage pixels, fed from a ResizeObserver on the cards.
   */
  setReservedRects(rects: Array<{ x: number; y: number; width: number; height: number }>): void {
    const next = rects.map((r) => ({ a: r.x, b: r.y, c: r.x + r.width, d: r.y + r.height }));
    const same =
      next.length === this.reserved.length &&
      next.every((r, i) => {
        const p = this.reserved[i];
        return p !== undefined && p.a === r.a && p.b === r.b && p.c === r.c && p.d === r.d;
      });
    if (same) return;
    this.reserved = next;
    this.invalidate();
  }

  /**
   * The style profile the field paints with (`profile.ts`). `classic` is the
   * shipped field, byte for byte; `fused` is the promoted HUD's four rules.
   */
  setProfile(profile: StyleProfile): void {
    if (this.profile === profile) return;
    this.profile = profile;
    this.invalidate();
  }

  getProfile(): StyleProfile {
    return this.profile;
  }

  /** Fused only: a label must sit inside this circle to be placed. */
  setLabelWindow(win: LabelWindow | null): void {
    const same =
      win === this.labelWindow ||
      (win !== null &&
        this.labelWindow !== null &&
        win.x === this.labelWindow.x &&
        win.y === this.labelWindow.y &&
        win.r === this.labelWindow.r);
    if (same) return;
    this.labelWindow = win;
    this.invalidate();
  }

  setLens(on: boolean): void {
    this.lens = { ...this.lens, on };
    this.invalidate();
  }

  setHover(node: GalaxyNode | null): void {
    if (this.hover === node) return;
    this.hover = node;
    this.invalidate();
  }

  getCamera(): CameraState {
    return { ...this.camera };
  }

  // ── the fused stage's seams ──────────────────────────────────────────────

  /**
   * Run after every frame the engine draws. The fused instruments (needle,
   * dock, bezel) follow the camera here, so they move on its curve and cost
   * nothing at rest: the engine only draws when something moves.
   */
  onFrame(listener: () => void): () => void {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  }

  /**
   * Give the chrome room. The change EASES on a flight that re-frames the
   * current focus into the space that is left, so the dock rises and the
   * document opens with the field rather than snapping beside it.
   */
  setInsets(next: StageInsets, reframe = true): void {
    const current = this.insetsTo ?? this.insets;
    if (current.l === next.l && current.r === next.r && current.b === next.b) return;
    if (!this.layout || !reframe) {
      this.insets = { ...next };
      this.insetsTo = null;
      this.invalidate();
      return;
    }
    this.insetsTo = { ...next };
    this.reframe();
  }

  getInsets(): StageInsets {
    return { ...this.insets };
  }

  /** The insets the current flight is heading to. */
  getTargetInsets(): StageInsets {
    return { ...(this.insetsTo ?? this.insets) };
  }

  setFrameFill(fill: ((level: number, v: Viewport) => number) | null): void {
    this.frameFill = fill;
  }

  /** Fused only: with reduced motion every flight (and every inset) lands at once. */
  setReducedMotion(on: boolean): void {
    this.reduceMotion = on;
  }

  /** Fly back to the frame the current focus deserves (Fit, a mode switch). */
  reframe(ms = FLIGHT_MS): void {
    if (!this.layout) return;
    if (this.focus.kind === 'council') {
      const stars = this.focus.registrySubjects
        .map((slug) => this.layout?.bySlug.get(slug))
        .filter((s): s is SubjectNode => Boolean(s));
      const target = fitToSet(this.frameViewport(), stars);
      if (target) this.flyTo(target, ms);
      return;
    }
    this.flyTo(this.frameOf(this.subject ?? this.category ?? this.domain), ms);
  }

  getViewport(): Viewport {
    return this.viewport();
  }

  getSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  getLayout(): GalaxyLayout | null {
    return this.layout;
  }

  getPath(): EnginePath {
    const technique = this.pinned?.node.kind === 'technique' ? this.pinned.node : null;
    return { domain: this.domain, category: this.category, subject: this.subject, technique };
  }

  getHover(): GalaxyNode | null {
    return this.hover;
  }

  /** Eased progress (0..1) of the flight in progress and its id; e is 1 at rest. */
  getFlight(): { id: number; e: number; flying: boolean } {
    return { id: this.flightId, e: this.flightE, flying: this.flight !== 0 };
  }

  /**
   * Where the reader is on the altitude ladder, continuously: 0 sky, 1
   * domain, 2 category, 3 subject, 4 a technique. It moves on the flight's
   * eased curve, so a needle that reads it lands WITH the camera.
   */
  getAltitude(): number {
    return this.altitudeNow;
  }

  private level(): number {
    if (this.pinned?.node.kind === 'technique') return 4;
    if (this.subject) return 3;
    if (this.category) return 2;
    if (this.domain) return 1;
    return 0;
  }

  /** The frame a node (or the sky, for null) is shown at. */
  private frameOf(node: DomainNode | CategoryNode | SubjectNode | null): CameraState {
    const v = this.frameViewport();
    if (!node) return { x: 0, y: 0, k: this.skyK() };
    if (node.kind === 'domain') return { x: node.x, y: node.y, k: domainScale(v, node) };
    if (node.kind === 'category') return { x: node.x, y: node.y, k: categoryScale(v, node) };
    return { x: node.x, y: node.y, k: subjectScale(v) };
  }

  /**
   * Go to any node from outside the field (the list, a care cell, the dial):
   * a technique opens as the pinned technique of its own subject, anything
   * else is descended into, remembering the view it leaves.
   */
  goTo(node: GalaxyNode, replace = false): void {
    // `replace` steps to a neighbour: the view is swapped rather than
    // stacked, so Esc still climbs to the parent instead of the sibling.
    const depth = this.stack.length;
    if (node.kind === 'technique') {
      if (this.subject !== node.subject) {
        this.unpin();
        this.descend(node.subject);
        if (replace) this.stack.length = depth;
      }
      const v = this.viewport();
      const { cx, cy } = viewportCentre(v);
      this.pin(node, cx, cy);
      return;
    }
    this.unpin();
    this.descend(node);
    if (replace) this.stack.length = depth;
  }

  /**
   * Climb straight to one rung (0 sky .. 3 subject). Frames the descent
   * pushed are popped on the way, so a climb that retraces clicks returns to
   * the exact camera it left; a rung reached by a jump is framed afresh.
   */
  climbTo(level: number): void {
    this.unpin();
    const path: [DomainNode | null, CategoryNode | null, SubjectNode | null] = [this.domain, this.category, this.subject];
    const target = level <= 0 ? null : (path[level - 1] ?? null);
    if (this.level() <= level) return;
    let frame: CameraFrame | undefined;
    while (this.stack.length > 0) {
      frame = this.stack.pop();
      if (frame && depthOf(frame.focus) <= level) break;
    }
    this.domain = level >= 1 ? path[0] : null;
    this.category = level >= 2 ? path[1] : null;
    this.subject = level >= 3 ? path[2] : null;
    this.thread = null;
    const exact = frame && depthOf(frame.focus) === level && sameTarget(frame.focus, target);
    if (frame && !exact) this.stack.push(frame);
    this.flyTo(exact && frame ? { x: frame.x, y: frame.y, k: frame.k } : this.frameOf(target));
    this.emitFocus();
  }

  restoreCamera(camera: CameraState, ms = FLIGHT_MS): void {
    this.flyTo(camera, ms);
  }

  // ── focus ────────────────────────────────────────────────────────────────

  private stack: CameraFrame[] = [];

  /**
   * Point the whole layer at one focus. Council focus aims at the SET of stars
   * the council lands on and picks the lowest altitude that still holds them
   * all: one category if they share one, one cluster if they share one, the
   * whole field if they span several.
   */
  /**
   * Is the engine already standing in EXACTLY this focus object?
   *
   * Reference identity, deliberately: the caller that asks is the React host
   * relaying the store, and the only way the engine can hold the same object
   * is if that caller (or the store on its behalf) already applied it. A
   * structural comparison would also return true for a NEW object describing
   * the same place, which is a case the host must still fly.
   */
  hasFocus(focus: GalaxyFocus): boolean {
    return this.focus === focus;
  }

  setFocus(focus: GalaxyFocus, fly = true): void {
    this.focus = focus;
    this.applyFocus(focus, fly);
    this.invalidate();
  }

  private applyFocus(focus: GalaxyFocus, fly: boolean): void {
    const layout = this.layout;
    if (!layout) return;
    this.domain = null;
    this.category = null;
    this.subject = null;
    this.thread = null;

    if (focus.kind === 'council') {
      const stars = focus.registrySubjects
        .map((slug) => layout.bySlug.get(slug))
        .filter((s): s is SubjectNode => Boolean(s));
      this.thread = new Set(focus.registrySubjects);
      const categories = new Set(stars.map((s) => s.category));
      const domains = new Set(stars.map((s) => s.domain));
      if (categories.size === 1) {
        this.category = [...categories][0] ?? null;
        this.domain = this.category?.domain ?? null;
      } else if (domains.size === 1) {
        this.domain = [...domains][0] ?? null;
      }
      const target = fitToSet(this.frameViewport(), stars);
      if (target && fly) this.flyTo(target, FLIGHT_MS);
      return;
    }

    if (focus.kind === 'node') {
      this.domain = layout.domains.find((d) => d.slug === focus.domainSlug) ?? null;
      this.category = this.domain?.categories.find((c) => c.id === focus.categoryId) ?? null;
      this.subject = this.category?.subjects.find((s) => s.slug === focus.subjectSlug) ?? null;
      if (!fly) return;
      if (this.subject) this.flyTo({ x: this.subject.x, y: this.subject.y, k: subjectScale(this.frameViewport()) });
      else if (this.category) this.flyTo({ x: this.category.x, y: this.category.y, k: categoryScale(this.frameViewport(), this.category) });
      else if (this.domain) this.flyTo({ x: this.domain.x, y: this.domain.y, k: domainScale(this.frameViewport(), this.domain) });
      return;
    }
    if (fly) this.flyTo({ x: 0, y: 0, k: this.skyK() });
  }

  private emitFocus(): void {
    this.focus =
      this.domain || this.category || this.subject
        ? {
            kind: 'node',
            domainSlug: this.domain?.slug ?? null,
            categoryId: this.category?.id ?? null,
            subjectSlug: this.subject?.slug ?? null,
          }
        : { kind: 'none' };
    this.callbacks.onFocusChange(this.focus);
  }

  /** Descend into a node, remembering the exact view we are leaving. */
  descend(node: GalaxyNode): void {
    if (node.kind === 'technique') return;
    this.stack.push({ ...this.camera, focus: this.focus });
    if (node.kind === 'domain') {
      this.domain = node;
      this.category = null;
      this.subject = null;
      this.flyTo({ x: node.x, y: node.y, k: domainScale(this.frameViewport(), node) });
    } else if (node.kind === 'category') {
      this.domain = node.domain;
      this.category = node;
      this.subject = null;
      this.flyTo({ x: node.x, y: node.y, k: categoryScale(this.frameViewport(), node) });
    } else {
      this.domain = node.domain;
      this.category = node.category;
      this.subject = node;
      this.flyTo({ x: node.x, y: node.y, k: subjectScale(this.frameViewport()) });
    }
    this.thread = null;
    this.emitFocus();
  }

  /**
   * Climb one layer. The camera returns EXACTLY where it was.
   *
   * A pinned technique card is the FIRST thing a climb takes down, which is
   * what makes four clicks down and four Escapes up symmetrical: the fourth
   * click opened a card rather than a layer, so the first Escape closes it.
   */
  climb(): boolean {
    if (this.unpin()) return true;
    const frame = this.stack.pop();
    if (!frame) {
      if (this.focus.kind === 'none') return false;
      this.domain = null;
      this.category = null;
      this.subject = null;
      this.thread = null;
      this.flyTo({ x: 0, y: 0, k: this.skyK() });
      this.emitFocus();
      return true;
    }
    this.focus = frame.focus;
    this.applyFocus(frame.focus, false);
    this.flyTo({ x: frame.x, y: frame.y, k: frame.k }, FLIGHT_MS);
    this.callbacks.onFocusChange(this.focus);
    return true;
  }

  fit(): void {
    this.stack.length = 0;
    this.domain = null;
    this.category = null;
    this.subject = null;
    this.flyTo({ x: 0, y: 0, k: this.skyK() });
    if (this.focus.kind !== 'council') this.emitFocus();
  }

  zoomBy(factor: number): void {
    this.camera.k = Math.max(this.skyK() * 0.5, Math.min(MAX_SCALE, this.camera.k * factor));
    this.syncAltitude();
    this.invalidate();
  }

  /** Centre one node without changing altitude — the rail's "show me this". */
  aimAt(node: GalaxyNode): void {
    this.flyTo({ x: node.x, y: node.y, k: this.camera.k }, FLIGHT_MS);
  }

  // ── geometry ─────────────────────────────────────────────────────────────

  private viewport(ins: StageInsets = this.insets): Viewport {
    return { x0: ins.l, x1: this.width - ins.r, y0: 0, y1: Math.max(150, this.height - this.benchHeight - ins.b) };
  }

  /**
   * The viewport a NEW frame is computed against: the one the flight is
   * heading to, shrunk round its centre by the frame fill. With no insets
   * and no fill it is exactly `viewport()`.
   */
  private frameViewport(): Viewport {
    const v = this.viewport(this.insetsTo ?? this.insets);
    if (!this.frameFill) return v;
    const f = this.frameFill(Math.min(3, this.level()), v);
    const { cx, cy } = viewportCentre(v);
    const hw = ((v.x1 - v.x0) / 2) * f;
    const hh = ((v.y1 - v.y0) / 2) * f;
    return { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh };
  }

  private skyK(): number {
    return skyScale(this.frameViewport(), this.layout?.boundRadius ?? 1);
  }

  private altitude(): Altitude {
    if (this.subject) return 'subject';
    if (this.category) return 'category';
    if (this.domain) return 'domain';
    return 'sky';
  }

  private resize(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    this.width = rect.width;
    this.height = rect.height;
    canvas.width = Math.round(rect.width * this.dpr);
    canvas.height = Math.round(rect.height * this.dpr);
    this.invalidate();
  }

  // ── drawing ──────────────────────────────────────────────────────────────

  invalidate(): void {
    if (this.dirty) return;
    this.dirty = true;
    this.frame = requestAnimationFrame(() => {
      this.dirty = false;
      this.frame = 0;
      this.draw();
    });
  }

  private flyTo(target: CameraState, duration = FLIGHT_MS): void {
    if (this.flight) cancelAnimationFrame(this.flight);
    const ms = this.reduceMotion ? 1 : duration;
    const from = { ...this.camera };
    const t0 = performance.now();
    // The fused seams ride the same curve: the insets (dock, column,
    // document) and the altitude the needle reads. Both are inert for the
    // classic stage, whose insets never move.
    const insFrom = this.insetsTo ? { ...this.insets } : null;
    const insTo = this.insetsTo;
    this.flightId += 1;
    this.altitudeFrom = this.altitudeNow;
    this.altitudeTo = this.level();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const e = p >= 1 ? 1 : easeStandard(p);
      this.flightE = e;
      this.altitudeNow = this.altitudeFrom + (this.altitudeTo - this.altitudeFrom) * e;
      if (insFrom && insTo) {
        this.insets = p >= 1 ? { ...insTo } : lerpInsets(insFrom, insTo, e);
        if (p >= 1 && this.insetsTo === insTo) this.insetsTo = null;
      }
      // The last frame SNAPS to the target rather than interpolating to it:
      // the log-space `k` tween lands within a float epsilon of the target,
      // which is invisible on screen and fatal to "the camera returns
      // EXACTLY where it was", which is a promise this layer makes twice
      // (`climb()` and the bench).
      this.camera = p >= 1 ? { ...target } : tweenCamera(from, target, p);
      this.draw();
      if (p < 1) this.flight = requestAnimationFrame(step);
      else this.flight = 0;
    };
    this.flight = requestAnimationFrame(step);
  }

  private draw(): void {
    const { ctx, layout, theme } = this;
    if (!ctx || !layout || !theme) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.labelsHidden = paintFrame({
      ctx,
      captions: this.captions,
      theme,
      width: this.width,
      height: this.height,
      viewport: this.viewport(),
      camera: this.camera,
      layout,
      lens: this.lens,
      altitude: this.altitude(),
      domain: this.domain,
      category: this.category,
      subject: this.subject,
      hover: this.hover,
      thread: this.thread,
      labels: this.labels,
      picks: this.picks,
      reserved: this.reserved,
      ...(this.profile === 'fused'
        ? { profile: this.profile, obstacles: this.obstacles, labelWindow: this.labelWindow }
        : {}),
    });
    this.callbacks.onCounts(this.counts());
    if (this.frame === 0 && this.flight === 0) this.altitudeNow = this.level();
    for (const listener of this.frameListeners) listener();
  }

  private counts(): GalaxyCounts {
    const layout = this.layout;
    const lit = this.thread ? this.thread.size : 0;
    return {
      altitude: this.altitude(),
      shown: this.rowCount(),
      lit,
      dimmed: this.thread && layout ? Math.max(0, layout.subjects.length - lit) : 0,
      labelsHidden: this.labelsHidden,
    };
  }

  private rowCount(): number {
    if (this.thread) return this.thread.size;
    if (this.subject) return this.subject.techniques.length;
    if (this.category) return this.category.subjects.length;
    if (this.domain) return this.domain.categories.length;
    return this.layout?.domains.length ?? 0;
  }

  // ── input ────────────────────────────────────────────────────────────────

  private stagePoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /**
   * What is under this point.
   *
   * TEXT WINS OVER GEOMETRY. A title is painted on top of the node it names
   * and reaches beyond it, so a rect target is tested by containment first
   * and returned before any disc is considered; otherwise the current
   * subject's own title would be swallowed by the disc behind it and the
   * canvas would have no way back up. Discs are then resolved by distance,
   * so the nearest of several overlapping 24 px child targets wins.
   */
  private hit(x: number, y: number): PickTarget | null {
    for (let i = this.picks.length - 1; i >= 0; i -= 1) {
      const p = this.picks[i];
      const r = p?.rect;
      if (!r) continue;
      if (x >= r.a && x <= r.c && y >= r.b && y <= r.d) return p;
    }
    let best: PickTarget | null = null;
    let bd = Infinity;
    for (let i = this.picks.length - 1; i >= 0; i -= 1) {
      const p = this.picks[i];
      if (!p || p.rect) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < p.r && d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  /** Open a technique's card and leave it open. */
  private pin(node: GalaxyNode, x: number, y: number): void {
    this.pinned = { node, x, y };
    this.hover = node;
    this.callbacks.onHoverChange(node);
    this.callbacks.onPointerTarget({ node, x, y, pinned: true });
    this.invalidate();
  }

  /** Take a pinned card down. True when there was one. */
  private unpin(): boolean {
    if (!this.pinned) return false;
    this.pinned = null;
    this.callbacks.onPointerTarget(null);
    this.invalidate();
    return true;
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // The card is anchored in screen space; moving the field under it would
    // leave it pointing at nothing.
    this.unpin();
    const { x, y } = this.stagePoint(e);
    const v = this.viewport();
    const { cx, cy } = viewportCentre(v);
    const wx = (x - cx) / this.camera.k + this.camera.x;
    const wy = (y - cy) / this.camera.k + this.camera.y;
    this.camera.k = Math.max(this.skyK() * 0.5, Math.min(MAX_SCALE, this.camera.k * Math.exp(-e.deltaY * 0.0016)));
    this.camera.x = wx - (x - cx) / this.camera.k;
    this.camera.y = wy - (y - cy) / this.camera.k;
    this.syncAltitude();
    this.invalidate();
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    this.canvas?.setPointerCapture(e.pointerId);
    this.drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, cx: this.camera.x, cy: this.camera.y, moved: 0 };
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    const { x, y } = this.stagePoint(e);
    this.lens = { ...this.lens, x, y };
    if (this.drag && this.drag.id === e.pointerId) {
      const dx = e.clientX - this.drag.sx;
      const dy = e.clientY - this.drag.sy;
      this.drag.moved = Math.max(this.drag.moved, Math.abs(dx) + Math.abs(dy));
      if (this.drag.moved > CLICK_SLOP) this.unpin();
      this.camera.x = this.drag.cx - dx / this.camera.k;
      this.camera.y = this.drag.cy - dy / this.camera.k;
      this.invalidate();
      return;
    }
    // A pinned card owns the card slot until Escape: the pointer may keep
    // lighting nodes underneath, but it may not replace what is being read.
    if (this.pinned) {
      this.invalidate();
      return;
    }
    const target = this.hit(x, y);
    const node = target?.node ?? null;
    if (node !== this.hover) {
      this.hover = node;
      this.callbacks.onHoverChange(node);
    }
    this.callbacks.onPointerTarget(
      target && !target.climb ? { node: target.node, x: target.x, y: target.y, pinned: false } : null,
    );
    this.invalidate();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (this.drag?.id === e.pointerId) {
      if (this.canvas?.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      window.setTimeout(() => {
        this.drag = null;
      }, 0);
    }
  };

  private readonly onPointerLeave = (): void => {
    this.lens = { ...this.lens, x: null, y: null };
    // A pinned card is being READ; leaving the canvas must not take it away.
    if (this.pinned) {
      this.invalidate();
      return;
    }
    if (this.hover) {
      this.hover = null;
      this.callbacks.onHoverChange(null);
    }
    this.callbacks.onPointerTarget(null);
    this.invalidate();
  };

  /**
   * ONE CLICK ALWAYS UNCOVERS THE LAYER UNDER WHAT YOU CLICKED.
   *
   * Sky to a domain to a category to a subject to that subject's techniques
   * orbiting it, and then a technique's own card, which is where the descent
   * ends because there is nothing under a technique. Four clicks from the sky
   * reach a technique with no zoom gesture, and four Escapes undo them.
   *
   * The ONE click that goes the other way is a click on the title of the node
   * you are already standing in - the canvas twin of the breadcrumb. It
   * arrives here carrying `climb`, minted by the label pass.
   *
   * What this replaced did nothing at all for a technique, and nothing for a
   * click on the domain or category you were already in, so three of the five
   * things a reader could click were inert.
   */
  private readonly onClick = (e: MouseEvent): void => {
    if (this.drag && this.drag.moved > CLICK_SLOP) return;
    const { x, y } = this.stagePoint(e);
    const target = this.hit(x, y);
    if (!target) return;
    if (target.climb) {
      this.climb();
      return;
    }
    const node = target.node;
    if (node.kind === 'technique') {
      this.pin(node, target.x, target.y);
      return;
    }
    this.unpin();
    this.descend(node);
  };

  /**
   * Free zooming changes the altitude the reader is at, so the rail and the
   * breadcrumb have to follow. Ported from the reference's `sync()`.
   */
  private syncAltitude(): void {
    const layout = this.layout;
    if (!layout || this.thread) return;
    const v = this.frameViewport();
    let changed = false;
    const nearest = <T extends { x: number; y: number }>(items: T[]): T | null => {
      let best: T | null = null;
      let bd = Infinity;
      for (const it of items) {
        const d = Math.hypot(it.x - this.camera.x, it.y - this.camera.y);
        if (d < bd) {
          bd = d;
          best = it;
        }
      }
      return best;
    };

    if (this.camera.k < this.skyK() * 2.1) {
      if (this.domain) {
        this.domain = null;
        this.category = null;
        this.subject = null;
        changed = true;
      }
    } else {
      const d = nearest(layout.domains);
      if (d && this.domain !== d) {
        this.domain = d;
        this.category = null;
        this.subject = null;
        changed = true;
      }
      const dom = this.domain;
      if (dom) {
        if (this.camera.k < domainScale(v, dom) * 1.7) {
          if (this.category) {
            this.category = null;
            this.subject = null;
            changed = true;
          }
        } else {
          const c = nearest(dom.categories);
          if (c && this.category !== c) {
            this.category = c;
            this.subject = null;
            changed = true;
          }
          if (this.camera.k < subjectScale(v) * 0.55) {
            if (this.subject) {
              this.subject = null;
              changed = true;
            }
          } else {
            const s = nearest(this.category?.subjects ?? []);
            if (s && this.subject !== s) {
              this.subject = s;
              changed = true;
            }
          }
        }
      }
    }
    if (changed) this.emitFocus();
  }
}

export { LENS_R };

function lerpInsets(a: StageInsets, b: StageInsets, e: number): StageInsets {
  return { l: a.l + (b.l - a.l) * e, r: a.r + (b.r - a.r) * e, b: a.b + (b.b - a.b) * e };
}

/** How deep a remembered focus stood: 0 sky .. 3 subject. */
function depthOf(focus: GalaxyFocus): number {
  if (focus.kind !== 'node') return 0;
  if (focus.subjectSlug) return 3;
  if (focus.categoryId) return 2;
  if (focus.domainSlug) return 1;
  return 0;
}

function sameTarget(focus: GalaxyFocus, node: GalaxyNode | null): boolean {
  if (!node) return focus.kind !== 'node' || depthOf(focus) === 0;
  if (focus.kind !== 'node') return false;
  if (node.kind === 'domain') return focus.domainSlug === node.slug;
  if (node.kind === 'category') return focus.categoryId === node.id;
  if (node.kind === 'subject') return focus.subjectSlug === node.slug;
  return false;
}
