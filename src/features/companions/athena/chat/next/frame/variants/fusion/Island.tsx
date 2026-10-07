/**
 * Fusion · the island (R5 · A's bottom panel, copied and adapted). ONE glass
 * object at the bottom centre of the window: at rest a capsule (her face, one
 * label, the human gate, the key); opened, the same glass grows upward into
 * the conversation sheet and folds back on Esc. Width, height and radius
 * animate as one shape anchored on its bottom edge, while the content for the
 * new size is laid out at its FINAL size from the first frame and revealed by
 * the growing glass, so text never reflows mid-morph.
 *
 * Fusion's change: a decision no longer grows the island into a sheet. The
 * question and its answers are their own pieces over the app
 * (`DecisionStage`), and the island narrows to just its composer row, so you
 * can still talk to her about the call in front of you.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { FUSION_COPY as F } from './copy';
import { EASE } from './text';

export type IslandMode = 'rest' | 'chat' | 'tall' | 'decide';

/**
 * The island's fixed boxes, in the px their CSS tokens resolve to right now.
 * The heights live in `fusion.css` (`--fu-cap-h`, `--fu-row-h`, `--fu-dock-b`,
 * `--radius-modal`) as multiples of the type unit, so they follow Settings >
 * Appearance > text size. Framer animates numbers, so `useIslandMetrics` reads
 * them back from four hidden probes and re-reads when the text size moves.
 */
export interface IslandMetrics {
  /** The resting capsule's height. */
  cap: number;
  /** The decision row's height (the composer alone). */
  row: number;
  /** How far the island's bottom edge sits above the layer's bottom. */
  dock: number;
  /** The open sheet's corner radius. */
  modal: number;
}

const FALLBACK_METRICS: IslandMetrics = { cap: 44, row: 62, dock: 44, modal: 16 };
/** What the rail reserves on the right, mirrored on the left so the island stays centred. */
const RAIL_RESERVE = 64;

export function islandSize(mode: IslandMode, restW: number, layer: { w: number; h: number }, m: IslandMetrics) {
  const availH = Math.max(240, layer.h - m.dock - 10);
  const availW = Math.max(360, layer.w - 32 - RAIL_RESERVE * 2);
  switch (mode) {
    case 'rest':
      return { w: restW, h: m.cap, r: m.cap / 2 };
    case 'chat':
      return { w: Math.min(availW, 980), h: Math.min(availH, Math.max(460, Math.round(availH * 0.84))), r: m.modal };
    case 'tall':
      return { w: Math.min(availW, 1180), h: availH, r: m.modal };
    case 'decide':
      return { w: Math.min(availW, 820), h: m.row, r: m.row / 2 };
  }
}

function useIslandMetrics(ref: RefObject<HTMLSpanElement | null>): IslandMetrics {
  const [m, setM] = useState(FALLBACK_METRICS);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const probes = Array.from(box.children) as HTMLElement[];
    const measure = () => {
      const [cap, row, dock, modal] = probes.map((el) => el.offsetHeight) as [number, number, number, number];
      setM((prev) =>
        prev.cap === cap && prev.row === row && prev.dock === dock && prev.modal === modal ? prev : { cap, row, dock, modal },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    probes.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [ref]);
  return m;
}

/** The layer's size, kept current: the open sheet sizes itself from it. */
export function useLayerSize(ref: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 1280, h: 688 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setSize((prev) => (prev.w === el.clientWidth && prev.h === el.clientHeight ? prev : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export function Island({
  mode,
  layer,
  rest,
  open,
}: {
  mode: IslandMode;
  layer: { w: number; h: number };
  /** The capsule's content, measured at its natural width. */
  rest: ReactNode;
  /** The open content; laid out at the target size of `mode`. */
  open: ReactNode;
}) {
  const { shouldAnimate } = useMotion();
  const restRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const metrics = useIslandMetrics(probeRef);
  const [restW, setRestW] = useState(300);
  useLayoutEffect(() => {
    const el = restRef.current;
    if (!el) return;
    const measure = () => setRestW((prev) => (Math.abs(prev - el.offsetWidth) < 1 ? prev : el.offsetWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode]);

  // A mode change is one 0.42s morph. Once the capsule has settled, its glass
  // instead TRACKS the content (a gate leaving, a label changing) on a short
  // tween, so the glass never lingers wider than what it holds.
  const [prevMode, setPrevMode] = useState(mode);
  const [settled, setSettled] = useState(true);
  if (mode !== prevMode) {
    setPrevMode(mode);
    setSettled(false);
  }
  useEffect(() => {
    if (settled) return;
    const id = window.setTimeout(() => setSettled(true), 480);
    return () => window.clearTimeout(id);
  }, [settled, mode]);

  const size = islandSize(mode, restW, layer, metrics);
  const resting = mode === 'rest';
  const grow = { duration: shouldAnimate ? (resting && settled ? 0.14 : 0.42) : 0, ease: EASE };

  return (
    <div className="fu-dock">
      <span ref={probeRef} className="fu-probe" aria-hidden>
        <i />
        <i />
        <i />
        <i />
      </span>
      <motion.div
        className={`fu-island fu-glass${resting ? '' : ' is-open'}${mode === 'decide' ? ' is-row' : ''}`}
        initial={false}
        animate={{ width: size.w, height: size.h, borderRadius: size.r }}
        transition={grow}
        data-testid="companion-fusion-island-shape"
        data-island-mode={mode}
        role="region"
        aria-label={F.island}
      >
        <AnimatePresence initial={false}>
          {resting ? (
            <motion.div
              key="rest"
              ref={restRef}
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-max"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: shouldAnimate ? 0.22 : 0, delay: shouldAnimate ? 0.16 : 0 } }}
              exit={{ opacity: 0, transition: { duration: shouldAnimate ? 0.1 : 0 } }}
            >
              {rest}
            </motion.div>
          ) : (
            <motion.div
              key="open"
              className="absolute bottom-0 left-1/2 -translate-x-1/2 flex flex-col"
              style={{ width: size.w, height: size.h }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: shouldAnimate ? 0.26 : 0, delay: shouldAnimate ? 0.1 : 0 } }}
              exit={{ opacity: 0, transition: { duration: shouldAnimate ? 0.12 : 0 } }}
            >
              {open}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
