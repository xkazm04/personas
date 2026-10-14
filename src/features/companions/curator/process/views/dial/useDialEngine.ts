import { useEffect, useRef, type RefObject } from 'react';
import { drawStatic } from './dialDraw';
import { drawFx, makePulses, type Pulse, type Spark } from './dialFx';
import { ease, lerp } from './dialFormat';
import { makeGeo, type Geo, type Paint } from './dialGeo';
import { bindPointer } from './dialPointer';
import type { RepoArc, Ring } from './dialModel';
import { readPalette, type Palette } from './dialPalette';

/**
 * The Dial's render engine: two canvases, one rAF loop that runs only while something moves.
 *
 * - The instrument layer is redrawn when its inputs change (hover, sweep, camera, resize) and is
 *   otherwise left alone. A pointer move never redraws it: the pointer is coalesced into one
 *   hit-test per frame and React hears about it only when the hovered item changes.
 * - The light layer animates while the figure is idle, and the loop stops when the document is
 *   hidden, when a ring is unrolled, and under reduced motion (where it paints once, still).
 * - Geometry is computed per (size, station count) in `layout()`, never in the draw path.
 */
export interface DialEngineProps {
  rings: Ring[];
  arcs: RepoArc[];
  repo: string | null;
  level: number;
  q: number | null;
  hover: number | null;
  hoverRepo: number | null;
  outcome: string | null;
  tint: string | null;
  /** changes when the figure should sweep in again */
  introKey: string;
  introMs: number;
  themeKey: string;
  /** the app's own reduce-motion setting; the OS preference is read here */
  still: boolean;
  onHover: (q: number | null) => void;
  onHoverRepo: (k: number | null) => void;
  onOpenRing: (q: number) => void;
  onPickRepo: (name: string | null) => void;
  onIntro: (running: boolean) => void;
}

interface Tween { t0: number; ms: number; from: number; to: number; set: (v: number) => void; done?: () => void; key?: string }

export interface DialRefs {
  host: RefObject<HTMLElement | null>;
  box: RefObject<HTMLElement | null>;
  ruler: RefObject<HTMLElement | null>;
  base: RefObject<HTMLCanvasElement | null>;
  fx: RefObject<HTMLCanvasElement | null>;
  skip: RefObject<(() => void) | null>;
}

interface Ctl { sync: () => void; intro: (ms: number) => void; camera: (level: number, q: number | null) => void }

const reducedQuery = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null);

export function useDialEngine(props: DialEngineProps, refs: DialRefs) {
  const P = useRef(props);
  P.current = props;
  const E = useRef<Ctl | null>(null);
  const { host: hostRef, box: boxRef, ruler: rulerRef, base: baseRef, fx: fxRef, skip: skipRef } = refs;

  useEffect(() => {
    const host = hostRef.current, box = boxRef.current, baseEl = baseRef.current, fxEl = fxRef.current;
    const bc = baseEl?.getContext('2d'), fc = fxEl?.getContext('2d');
    if (!host || !box || !baseEl || !fxEl || !bc || !fc) return;
    const mq = reducedQuery();
    let osReduced = !!mq?.matches;
    const isReduced = () => osReduced || P.current.still;
    let pal: Palette = readPalette(host);
    let palKey = P.current.themeKey;
    let geo: Geo | null = null, DPR = 1;
    let pulses: Pulse[] = [], sparks: Spark[] = [], pulsesFor: Ring[] | null = null;
    const paint: Paint = { hover: null, hoverRepo: null, repo: null, outcome: null, level: 0, camQ: 0, camU: 0, reveal: 0, tint: null };
    const cam = { t: 0, target: 0 };
    let tweens: Tween[] = [];
    let raf = 0, dirty = true, last = 0, introOn = false;

    const tween = (ms: number, from: number, to: number, set: (v: number) => void, done?: () => void, key?: 'cam' | 'reveal') => {
      if (key) tweens = tweens.filter((w) => w.key !== key);
      if (isReduced() || ms <= 0) { set(to); done?.(); dirty = true; return; }
      tweens.push({ t0: performance.now(), ms, from, to, set, done, key });
      kick();
    };
    const setCam = (t: number) => { cam.t = t; paint.camU = ease.inOutCubic(t); };

    const measureRuler = () => {
      const r = rulerRef.current;
      if (!r || !geo) return;
      const hb = host.getBoundingClientRect(), b = r.getBoundingClientRect();
      geo.ruler = { x0: b.left - hb.left + 4, x1: b.right - hb.left - 4, y: b.top - hb.top + b.height / 2, h: b.height * 0.66 };
    };
    const layout = () => {
      const W = host.clientWidth, H = host.clientHeight;
      if (!W || !H) return;
      DPR = Math.min(2, window.devicePixelRatio || 1);
      for (const [el, ctx] of [[baseEl, bc], [fxEl, fc]] as const) {
        if (el.width !== Math.round(W * DPR) || el.height !== Math.round(H * DPR)) { el.width = Math.round(W * DPR); el.height = Math.round(H * DPR); }
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      }
      const hb = host.getBoundingClientRect(), b = box.getBoundingClientRect();
      geo = makeGeo(W, H, { cx: b.left - hb.left + b.width / 2, cy: b.top - hb.top + b.height / 2, w: b.width, h: b.height }, P.current.rings.length);
      if (cam.t > 0) measureRuler();
      dirty = true;
      kick();
    };

    const fxActive = () => !document.hidden && !!geo && paint.level === 0 && !isReduced() && pulses.length > 0;
    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (tweens.length) {
        dirty = true;
        const live: Tween[] = [];
        for (const w of tweens) {
          const u = Math.min(1, (now - w.t0) / w.ms);
          w.set(lerp(w.from, w.to, u));
          if (u < 1) live.push(w); else w.done?.();
        }
        tweens = tweens.filter((w) => live.includes(w));
      }
      if (geo && cam.t > 0 && paint.level >= 1) measureRuler();
      if (geo && dirty) { dirty = false; drawStatic(bc, geo, paint, pal, { rings: P.current.rings, arcs: P.current.arcs }); }
      if (geo) drawFx(fc, geo, paint, pal, P.current.rings, pulses, sparks, dt, isReduced() || !fxActive());
      if (!document.hidden && (tweens.length || fxActive() || dirty)) raf = requestAnimationFrame(tick);
    };
    function kick() { if (!raf && !document.hidden) { last = performance.now(); raf = requestAnimationFrame(tick); } }

    const skipIntro = () => { if (!introOn) return; tween(200, paint.reveal, 1, (v) => { paint.reveal = v; }, () => { introOn = false; P.current.onIntro(false); }, 'reveal'); };

    // the sweep-in: re-runs whenever the introKey changes (the effect below)
    const intro = (ms: number) => {
      introOn = ms > 0 && !isReduced();
      P.current.onIntro(introOn);
      paint.reveal = 0;
      tween(ms, 0, 1, (v) => { paint.reveal = ease.inOutSine(v); }, () => { paint.reveal = 1; introOn = false; P.current.onIntro(false); }, 'reveal');
    };
    // the camera: a ring unrolls into the ruler and rolls back
    const camera = (level: number, q: number | null) => {
      const want = level >= 1 ? 1 : 0;
      if (want === 1 && q != null) {
        const go = () => { paint.camQ = q; cam.target = 1; measureRuler(); tween(1000, cam.t, 1, setCam, undefined, 'cam'); };
        if (cam.target === 1 && cam.t > 0.02 && paint.camQ !== q) tween(380, cam.t, 0, setCam, go, 'cam'); else go();
      } else if (cam.target !== 0 || cam.t > 0) { cam.target = 0; tween(760, cam.t, 0, setCam, undefined, 'cam'); }
    };
    // props -> paint, on every render; cheap field copies, a redraw only when one differs
    const sync = () => {
      const p = P.current;
      const tint = p.tint ? pal.phase[p.tint] ?? null : null;
      const next = { hover: p.hover, hoverRepo: p.hoverRepo, repo: p.repo, outcome: p.outcome, level: p.level, tint } as const;
      let changed = false;
      for (const k of Object.keys(next) as (keyof typeof next)[]) if (paint[k] !== next[k]) { (paint as unknown as Record<string, unknown>)[k] = next[k]; changed = true; }
      if (palKey !== p.themeKey) { palKey = p.themeKey; pal = readPalette(host); changed = true; }
      if (pulsesFor !== p.rings) { pulsesFor = p.rings; pulses = makePulses(p.rings); sparks = []; if (geo && geo.rMid.length !== p.rings.length) layout(); changed = true; }
      if (changed) { dirty = true; kick(); }
    };
    E.current = { sync, intro, camera };
    const ro = new ResizeObserver(() => layout());
    ro.observe(host); ro.observe(box);
    const unbind = bindPointer({
      host, geo: () => geo, level: () => paint.level, repoPicked: () => !!paint.repo, arcs: () => P.current.arcs,
      state: () => P.current, onHover: (q) => P.current.onHover(q), onHoverRepo: (k) => P.current.onHoverRepo(k),
      onOpenRing: (q) => P.current.onOpenRing(q), onPickRepo: (n) => P.current.onPickRepo(n),
    });
    const onVis = () => { if (!document.hidden) { dirty = true; kick(); } };
    const onMotion = () => { osReduced = !!mq?.matches; if (isReduced()) { tweens = []; paint.reveal = 1; } dirty = true; kick(); };
    document.addEventListener('visibilitychange', onVis);
    mq?.addEventListener('change', onMotion);
    skipRef.current = skipIntro;
    layout();
    return () => {
      cancelAnimationFrame(raf);
      unbind();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      mq?.removeEventListener('change', onMotion);
      skipRef.current = null;
      E.current = null;
    };
  }, [hostRef, boxRef, rulerRef, baseRef, fxRef, skipRef]);

  useEffect(() => { E.current?.sync(); });
  useEffect(() => { E.current?.intro(P.current.introMs); }, [props.introKey]);
  useEffect(() => { E.current?.camera(props.level, props.q); }, [props.level, props.q]);
}
