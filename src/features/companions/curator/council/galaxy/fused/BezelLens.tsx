// Mode `lens`: a porthole dial round the field. Four nested bands, one notch
// per technique, arc labels at 13 to 16 px, the lubber mark at 12 o'clock,
// amber blips where the waiting decisions sit, smoked glass in the product's
// tokens. It re-engraves on every focus and turns on the engine's curve;
// opening engraves it outward from 12 o'clock while the glass settles.
//
// Painted from the engine's frame callback (no loop of its own: 0 frames at
// rest). Outside the glass the pointer belongs to the dial - an arc shows the
// field's tooltip and a click flies there; inside, it belongs to the field,
// whose picks are pushed where the stars are drawn.
import { useCallback, useEffect, useRef, type RefObject } from 'react';

import type { EnginePath, GalaxyEngine } from '../engine/GalaxyEngine';
import type { GalaxyLayout, SubjectNode } from '../engine/types';
import { dialIndex } from './bezelDial';
import { paintBezel, type BezelScene } from './bezelPaint';
import { pickArc } from './bezelRim';
import { useFusedStore } from './fusedStore';
import type { InstrumentColors } from './tokenColors';
import { advanceScene, useBezelMotion } from './useBezelScene';

interface Props {
  engine: GalaxyEngine | null;
  layout: GalaxyLayout;
  path: EnginePath;
  colors: InstrumentColors | null;
  lit: Set<string> | null;
  waiting: SubjectNode[];
  stageRef: RefObject<HTMLElement | null>;
  beaconRef: RefObject<HTMLElement | null>;
}

export function BezelLens({ engine, layout, path, colors, lit, waiting, stageRef, beaconRef }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const scene = useRef<BezelScene | null>(null);
  const motion = useBezelMotion();
  const mode = useFusedStore((s) => s.mode);
  const setTip = useFusedStore((s) => s.setTip);

  const draw = useCallback(() => {
    const cv = ref.current;
    const g = cv?.getContext('2d');
    if (!cv || !g || !engine || !colors) return;
    const { width: W, height: H } = engine.getSize();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    const base = cv.getBoundingClientRect();
    const b = beaconRef.current?.getBoundingClientRect();
    const avoid = b ? new DOMRect(b.left - base.left, b.top - base.top, b.width, b.height) : null;
    const s = advanceScene(motion, engine, layout, path, mode === 'lens', { hover: engine.getHover(), lit, waiting, avoid });
    scene.current = s;
    // Labels in the field must sit inside the glass while it is open.
    engine.setLabelWindow(s.open > 0.02 ? { x: s.cx, y: s.cy, r: s.rg } : null);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintBezel(g, W, H, s, dialIndex(layout), motion.dial, colors);
  }, [engine, colors, layout, path, mode, lit, waiting, motion, beaconRef]);

  useEffect(() => {
    if (!engine) return;
    draw();
    return engine.onFrame(draw);
  }, [engine, draw]);

  // Outside the glass the pointer belongs to the dial (capture phase, so the
  // field underneath never sees a press it did not get).
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !engine) return;
    const at = (e: PointerEvent) => {
      const s = scene.current;
      const cv = ref.current;
      if (!s || !cv || mode !== 'lens' || s.open < 0.9) return null;
      if (!(e.target instanceof HTMLCanvasElement) || !e.target.closest('.fz-field')) return null;
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      if (Math.hypot(x - s.cx, y - s.cy) <= s.rg) return null;
      return { x, y, node: pickArc(x, y, s, dialIndex(layout), motion.dial) };
    };
    const move = (e: PointerEvent) => {
      const hit = at(e);
      if (!hit) return;
      e.stopPropagation();
      engine.setHover(hit.node);
      if (e.target instanceof HTMLElement) e.target.style.cursor = hit.node ? 'pointer' : 'default';
      setTip(hit.node ? { node: hit.node, x: hit.x, y: hit.y } : null);
    };
    const down = (e: PointerEvent) => {
      const hit = at(e);
      if (!hit) return;
      e.stopPropagation();
      if (hit.node) engine.goTo(hit.node);
    };
    const swallow = (e: Event) => {
      if (at(e as PointerEvent)) e.stopPropagation();
    };
    stage.addEventListener('pointermove', move, true);
    stage.addEventListener('pointerdown', down, true);
    stage.addEventListener('pointerup', swallow, true);
    stage.addEventListener('click', swallow, true);
    return () => {
      stage.removeEventListener('pointermove', move, true);
      stage.removeEventListener('pointerdown', down, true);
      stage.removeEventListener('pointerup', swallow, true);
      stage.removeEventListener('click', swallow, true);
    };
  }, [engine, layout, mode, motion, setTip, stageRef]);

  return <canvas ref={ref} className="fz-bezel" aria-hidden="true" data-role="hud-bezel" />;
}

export default BezelLens;
