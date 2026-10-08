/**
 * The Lifecycle page body: the load-failure banner (it keeps a warm snapshot on
 * screen) above ONE of two layers:
 *
 * - Layer 1 (`layer1/Layer1`): the whole practice as the collar rail;
 * - Layer 2 (`layer2/StepScreen`, a lazy chunk): one step's own screen, when a
 *   key was pressed. It replaces Layer 1 in place; the page does not navigate.
 *
 * The swap between the layers is one short, calm cross-slide (Layer 2 comes in
 * from the right, Layer 1 back from the left); walking between steps inside
 * Layer 2 does not replay it. Under reduced motion the swap is instant.
 *
 * Returning from Layer 2 puts focus back on the key of the step that was open,
 * once Layer 1 is mounted again, so a keyboard reader lands where they left.
 *
 * Loading: a cold first load ghosts Layer 1 in its real geometry; the Layer-2
 * chunk suspends into a ghost of its hero band (both delayed, so a warm or
 * prefetched load paints neither).
 */
import { Suspense, useEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { Banner } from '@/features/shared/components/feedback/Banner';
import { KitHost } from '@/features/shared/components/kit';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import { useLifecycleViewModel } from './context';
import { Layer1 } from './layer1/Layer1';
import { Layer1Ghost } from './layer1/Layer1Ghost';
import { LazyStepScreen } from './layer2/lazySteps';
import { StepScreenGhost } from './layer2/StepScreenGhost';
import { RHYTHM } from './system/lcSurface';
import './layer1/layer1.css';

/** Scroll the page's own scroll region back to its top, so a step's screen opens at its head. */
function scrollRegionToTop(el: HTMLElement | null) {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      node.scrollTop = 0;
      return;
    }
  }
}

/** Runs `onMount` once, after its subtree is in the document (after the exit of the other layer). */
function OnMount({ onMount, children }: { onMount: () => void; children: ReactNode }) {
  const ref = useRef(onMount);
  useEffect(() => { ref.current(); }, []);
  return <>{children}</>;
}

const SWAP = { duration: 0.16, ease: [0.22, 1, 0.36, 1] as const };

export function LifecycleBody() {
  const { dl, order, loading, error, refetch, openStepId } = useLifecycleViewModel();
  const reduced = useReducedMotion();
  const open = openStepId ? order.find((n) => n.id === openStepId) ?? null : null;
  const hostRef = useRef<HTMLDivElement>(null);
  const lastOpen = useRef<string | null>(null);
  const returnTo = useRef<string | null>(null);

  useEffect(() => {
    if (open) {
      if (!lastOpen.current) scrollRegionToTop(hostRef.current);
      lastOpen.current = open.id;
      return;
    }
    returnTo.current = lastOpen.current;
    lastOpen.current = null;
  }, [open]);

  const restoreFocus = () => {
    const back = returnTo.current;
    returnTo.current = null;
    if (back) hostRef.current?.querySelector<HTMLElement>(`[data-testid="lc-node-${back}"]`)?.focus();
  };

  const slide = (dx: number) => (reduced
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1, transition: { duration: 0 } } }
    : { initial: { opacity: 0, x: dx }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: -dx / 2 }, transition: SWAP });

  const layer = open ? (
    <motion.div key="l2" {...slide(16)}>
      <Suspense fallback={<StepScreenGhost />}>
        <LazyStepScreen node={open} />
      </Suspense>
    </motion.div>
  ) : order.length > 0 ? (
    <motion.div key="l1" {...slide(-16)}>
      <OnMount onMount={restoreFocus}><Layer1 /></OnMount>
    </motion.div>
  ) : null;

  return (
    <KitHost testId="lc-journey">
      <div ref={hostRef} className={`${RHYTHM.block} pb-6`}>
        {error && <Banner severity="error" compact message={dl.lc_load_failed} cause={error} onRetry={refetch} />}
        {/* The ghost -> Layer 1 swap is a plain conditional (law 2: content is never held, and
            AnimatePresence mounts its first child still); only a press or a return between the
            two layers animates. */}
        {!layer && loading
          ? <Layer1Ghost />
          : <AnimatePresence mode="wait" initial={false}>{layer}</AnimatePresence>}
      </div>
    </KitHost>
  );
}
