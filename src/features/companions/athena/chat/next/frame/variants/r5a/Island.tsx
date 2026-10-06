/**
 * Island - the ONE object Athena is on screen. At rest it is a capsule at the
 * bottom centre of the window (just above the app footer); opened, the same
 * glass grows upward and outward into the conversation sheet or the decision
 * sheet, and folds back on Esc. There is no second surface and no pop: the
 * island's width, height and radius animate as one shape, anchored on its
 * bottom edge, while the content for the new size is laid out at its FINAL
 * size from the first frame and simply revealed by the growing glass (text
 * never reflows mid-morph, which is what makes a shared-layout morph read as
 * a cheap stretch).
 *
 * Bottom, not top (the seed said top-centre): the app's top edge is already
 * owned by the title bar, the route's own title and tabs, and the prototype
 * switcher, while the composer has always lived at the bottom. Putting the
 * island there lets the resting capsule BE the composer's place, so opening
 * the conversation puts the caret exactly where the capsule was.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { ISLAND_COPY as I } from './copy';

export type IslandMode = 'rest' | 'chat' | 'tall' | 'decide';

/** Where the island's bottom edge sits: clear of the app footer (h-8) by 12px. */
export const DOCK_BOTTOM = 44;
/** What the thread rail reserves on the right, so an open sheet never covers it. */
const RAIL_RESERVE = 64;

/** Head, key legend, composer and the sheet's own padding around a decision's content. */
const DECIDE_CHROME = 176;

export function islandSize(mode: IslandMode, restW: number, layer: { w: number; h: number }, decideContentH = 0) {
  const availH = Math.max(240, layer.h - DOCK_BOTTOM - 14);
  const availW = Math.max(360, layer.w - 48 - RAIL_RESERVE * 2);
  switch (mode) {
    case 'rest':
      return { w: restW, h: 44, r: 22 };
    case 'chat':
      return { w: Math.min(availW, 780), h: Math.min(availH, Math.max(460, Math.round(availH * 0.8))), r: 20 };
    case 'tall':
      return { w: Math.min(availW, 980), h: availH, r: 20 };
    case 'decide':
      return { w: Math.min(availW, 920), h: Math.min(availH, Math.max(400, decideContentH + DECIDE_CHROME)), r: 20 };
  }
}

/** The layer's size, kept current: the open sheets size themselves from it. */
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
  decideContentH,
}: {
  mode: IslandMode;
  /** The decision's own content height: a decision sheet is only as tall as what it asks. */
  decideContentH: number;
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

  const size = islandSize(mode, restW, layer, decideContentH);
  const resting = mode === 'rest';
  const ease = [0.22, 1, 0.36, 1] as const;
  const grow = { duration: shouldAnimate ? 0.42 : 0, ease };

  return (
    <div className="r5a-dock">
      <motion.div
        className={`r5a-island r5a-glass${resting ? '' : ' is-open'}`}
        initial={false}
        animate={{ width: size.w, height: size.h, borderRadius: size.r }}
        transition={grow}
        data-testid="companion-r5a-island-shape"
        data-island-mode={mode}
        role="region"
        aria-label={I.island}
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
