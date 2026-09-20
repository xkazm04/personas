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
  fitToSet,
  MAX_SCALE,
  skyScale,
  subjectScale,
  tweenCamera,
  viewportCentre,
  type Viewport,
} from './camera';
import { LabelQueue } from './labels';
import { LENS_R, type LensState } from './lens';
import { paintFrame, type CanvasCaptions, type PickTarget } from './paint';
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
} from './types';

export interface EngineCallbacks {
  /** The reader moved: the rail and the breadcrumb follow this, not the camera. */
  onFocusChange: (focus: GalaxyFocus) => void;
  onHoverChange: (node: GalaxyNode | null) => void;
  onCounts: (counts: GalaxyCounts) => void;
  /** Screen-space anchor for the hover card, or null to hide it. */
  onPointerTarget: (target: { node: GalaxyNode; x: number; y: number } | null) => void;
}

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

  private labelsHidden = 0;

  private frame = 0;

  private flight = 0;

  private dirty = false;

  private drag: { id: number; sx: number; sy: number; cx: number; cy: number; moved: number } | null = null;

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

  restoreCamera(camera: CameraState, ms = 520): void {
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
      const target = fitToSet(this.viewport(), stars);
      if (target && fly) this.flyTo(target, 700);
      return;
    }

    if (focus.kind === 'node') {
      this.domain = layout.domains.find((d) => d.slug === focus.domainSlug) ?? null;
      this.category = this.domain?.categories.find((c) => c.id === focus.categoryId) ?? null;
      this.subject = this.category?.subjects.find((s) => s.slug === focus.subjectSlug) ?? null;
      if (!fly) return;
      if (this.subject) this.flyTo({ x: this.subject.x, y: this.subject.y, k: subjectScale(this.viewport()) });
      else if (this.category) this.flyTo({ x: this.category.x, y: this.category.y, k: categoryScale(this.viewport(), this.category) });
      else if (this.domain) this.flyTo({ x: this.domain.x, y: this.domain.y, k: domainScale(this.viewport(), this.domain) });
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
      this.flyTo({ x: node.x, y: node.y, k: domainScale(this.viewport(), node) });
    } else if (node.kind === 'category') {
      this.domain = node.domain;
      this.category = node;
      this.subject = null;
      this.flyTo({ x: node.x, y: node.y, k: categoryScale(this.viewport(), node) });
    } else {
      this.domain = node.domain;
      this.category = node.category;
      this.subject = node;
      this.flyTo({ x: node.x, y: node.y, k: subjectScale(this.viewport()) });
    }
    this.thread = null;
    this.emitFocus();
  }

  /** Climb one layer. The camera returns EXACTLY where it was. */
  climb(): boolean {
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
    this.flyTo({ x: frame.x, y: frame.y, k: frame.k }, 420);
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
    this.flyTo({ x: node.x, y: node.y, k: this.camera.k }, 520);
  }

  // ── geometry ─────────────────────────────────────────────────────────────

  private viewport(): Viewport {
    return { x0: 0, x1: this.width, y0: 0, y1: Math.max(150, this.height - this.benchHeight) };
  }

  private skyK(): number {
    return skyScale(this.viewport(), this.layout?.boundRadius ?? 1);
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

  private flyTo(target: CameraState, ms = 620): void {
    if (this.flight) cancelAnimationFrame(this.flight);
    const from = { ...this.camera };
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      this.camera = tweenCamera(from, target, p);
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
    });
    this.callbacks.onCounts(this.counts());
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

  private hit(x: number, y: number): PickTarget | null {
    let best: PickTarget | null = null;
    let bd = Infinity;
    for (let i = this.picks.length - 1; i >= 0; i -= 1) {
      const p = this.picks[i];
      if (!p) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < p.r && d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
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
      this.camera.x = this.drag.cx - dx / this.camera.k;
      this.camera.y = this.drag.cy - dy / this.camera.k;
      this.invalidate();
      return;
    }
    const target = this.hit(x, y);
    const node = target?.node ?? null;
    if (node !== this.hover) {
      this.hover = node;
      this.callbacks.onHoverChange(node);
    }
    this.callbacks.onPointerTarget(target ? { node: target.node, x: target.x, y: target.y } : null);
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
    if (this.hover) {
      this.hover = null;
      this.callbacks.onHoverChange(null);
    }
    this.callbacks.onPointerTarget(null);
    this.invalidate();
  };

  private readonly onClick = (e: MouseEvent): void => {
    if (this.drag && this.drag.moved > 4) return;
    const { x, y } = this.stagePoint(e);
    const target = this.hit(x, y);
    if (!target) return;
    const node = target.node;
    if (node.kind === 'domain' && this.domain !== node) this.descend(node);
    else if (node.kind === 'category' && this.category !== node) this.descend(node);
    else if (node.kind === 'subject') this.descend(node);
  };

  /**
   * Free zooming changes the altitude the reader is at, so the rail and the
   * breadcrumb have to follow. Ported from the reference's `sync()`.
   */
  private syncAltitude(): void {
    const layout = this.layout;
    if (!layout || this.thread) return;
    const v = this.viewport();
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
