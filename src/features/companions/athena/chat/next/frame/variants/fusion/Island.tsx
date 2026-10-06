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
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { FUSION_COPY as F } from './copy';
import { EASE } from './text';

export type IslandMode = 'rest' | 'chat' | 'tall' | 'decide';

/** Where the island's bottom edge sits: clear of the app footer (h-8) by 12px. */
export const DOCK_BOTTOM = 44;
/** What the rail reserves on the right, mirrored on the left so the island stays centred. */
const RAIL_RESERVE = 64;

export function islandSize(mode: IslandMode, restW: number, layer: { w: number; h: number }) {
  const availH = Math.max(240, layer.h - DOCK_BOTTOM - 10);
  const availW = Math.max(360, layer.w - 32 - RAIL_RESERVE * 2);
  switch (mode) {
    case 'rest':
      return { w: restW, h: 44, r: 22 };
    case 'chat':
      return { w: Math.min(availW, 980), h: Math.min(availH, Math.max(460, Math.round(availH * 0.84))), r: 20 };
    case 'tall':
      return { w: Math.min(availW, 1180), h: availH, r: 20 };
    case 'decide':
      return { w: Math.min(availW, 820), h: 60, r: 30 };
  }
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

  const size = islandSize(mode, restW, layer);
  const resting = mode === 'rest';
  const grow = { duration: shouldAnimate ? 0.42 : 0, ease: EASE };

  return (
    <div className="fu-dock">
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
