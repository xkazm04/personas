import '../../styles/page.css';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, animate, usePresence } from 'framer-motion';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useSheet } from '../../controller/SheetContext';
import { SheetPage } from './SheetPage';

type Rect = { x: number; y: number; w: number; h: number };
/** bp's morph: 320 ms out of the tile, ease [.2, .7, .2, 1]; back into it in 85% of that, ease [.4, 0, .2, 1]. */
const MORPH = 0.32;
const FULL = 'translate(0px, 0px) scale(1, 1)';

/** The transform that lays the page box over the tile's rect (origin top left): where the morph starts and ends. */
function overTile(t: Rect, b: DOMRect): string {
  const sx = Math.max(0.02, t.w / b.width), sy = Math.max(0.02, t.h / b.height);
  return `translate(${(t.x - b.left).toFixed(1)}px, ${(t.y - b.top).toFixed(1)}px) scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
}

/** The page over the plan, with its dim. `morph`: grow out of the feature's tile and shrink back into it. */
function Layer({ fid, morph }: { fid: string; morph: boolean }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const page = useRef<HTMLElement>(null), inner = useRef<HTMLDivElement>(null), dim = useRef<HTMLDivElement>(null), closeRef = useRef<HTMLButtonElement>(null);
  const [isPresent, safeToRemove] = usePresence();
  // the page's content mounts a frame after the shell, so the morph is already running while it renders
  const [content, setContent] = useState(!morph);
  const engine = s.engine;
  // the tile's screen rect, from the engine (read-only): canvas-local, so offset by the canvas's own box
  const tileRect = (): Rect | null => {
    const r = engine?.featRect(fid, 1), c = engine?.cv.getBoundingClientRect();
    return r && c && r.w >= 1 && r.h >= 1 ? { x: c.left + r.x, y: c.top + r.y, w: r.w, h: r.h } : null;
  };
  const tileRef = useRef(tileRect);
  tileRef.current = tileRect;

  useLayoutEffect(() => {
    const el = page.current;
    if (!morph || !el) return;
    const t = tileRef.current(), b = el.getBoundingClientRect();
    const run = [dim.current ? animate(dim.current, { opacity: [0, 1] }, { duration: MORPH }) : null,
      inner.current ? animate(inner.current, { opacity: [0, 1] }, { duration: 0.2, delay: MORPH * 0.55 }) : null,
      t ? animate(el, { transform: [overTile(t, b), FULL] }, { duration: MORPH, ease: [0.2, 0.7, 0.2, 1] }) : animate(el, { opacity: [0, 1] }, { duration: 0.18 })];
    const raf = requestAnimationFrame(() => setContent(true));
    return () => { cancelAnimationFrame(raf); run.forEach((a) => a?.stop()); };
  }, [morph]);

  useEffect(() => {
    const id = window.setTimeout(() => closeRef.current?.focus({ preventScroll: true }), morph ? MORPH * 1000 + 40 : 0);
    return () => window.clearTimeout(id);
  }, [morph]);

  useEffect(() => {
    if (isPresent) return;
    const el = page.current;
    if (!el) { safeToRemove?.(); return; }
    el.style.transform = '';
    const t = tileRef.current(), b = el.getBoundingClientRect();
    if (inner.current) animate(inner.current, { opacity: 0 }, { duration: 0.08 });
    if (dim.current) animate(dim.current, { opacity: 0 }, { duration: MORPH });
    const a = t ? animate(el, { transform: [FULL, overTile(t, b)] }, { duration: MORPH * 0.85, ease: [0.4, 0, 0.2, 1] }) : animate(el, { opacity: 0 }, { duration: 0.18 });
    void a.then(() => safeToRemove?.());
    return () => a.stop();
  }, [isPresent, safeToRemove]);

  const name = s.plan.L.TILE[fid]?.f.name ?? fid;
  return (
    <div className="pg-layer">
      <div ref={dim} className="pg-dim" aria-hidden="true" onClick={s.nav.closeSheet}
        onWheel={(e) => page.current?.querySelector('.pg-scroll')?.scrollBy({ top: e.deltaY })} />
      <section ref={page} className="pg" aria-label={tx(B.pg_label, { name })} data-testid="blueprint-feature-sheet" data-feature={fid}>
        <div ref={inner} className="pg-in">{content ? <SheetPage fid={fid} enter={morph ? MORPH * 0.55 : 0} closeRef={closeRef} /> : null}</div>
        <div className="pg-frame" aria-hidden="true" />
      </section>
    </div>
  );
}

/**
 * L4, the feature page (bp FeatureSheet): one feature as a full page nested in the plan. The feature's tile grows
 * into the page (a ~320 ms transform morph from the tile's rect, the engine's `featRect`) while the plan dims behind
 * it, still showing at the edges; closing shrinks the page back into the tile. Under reduced motion there is no
 * morph and no count: the page is simply there. Stepping to another feature inside the page swaps its content in
 * place; only opening and closing morph. Keys are the sheet's own (useSheetKeys): A, X and B act on the current item
 * here as in the queue, Y, R, S and U triage the built item the compare panel shows.
 */
export function FeatureSheet() {
  const s = useSheet();
  const reduce = useReducedMotion();
  const fid = s.ui.sheet && s.plan.L.TILE[s.ui.sheet] ? s.ui.sheet : null;
  // every opening is a new page instance: one that opens while the last is still shrinking away runs its own morph
  const [inst, setInst] = useState({ open: false, n: 0 });
  if (!!fid !== inst.open) setInst({ open: !!fid, n: fid ? inst.n + 1 : inst.n });
  if (reduce) return fid ? <Layer fid={fid} morph={false} /> : null;
  return <AnimatePresence>{fid ? <Layer key={inst.n} fid={fid} morph /> : null}</AnimatePresence>;
}
