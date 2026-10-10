/**
 * The Lifecycle page body: the load-failure banner (it keeps a warm snapshot on
 * screen) above ONE of two layers:
 *
 * - Layer 1 (`layer1/Layer1`): the whole practice as the collar rail;
 * - Layer 2 (`layer2/StepScreen`, a lazy chunk): one step's own screen, when a
 *   key was pressed. It replaces Layer 1 in place; the page does not navigate.
 *
 * The swap between the layers is the pressed KEY becoming the screen: the
 * layers cross-fade (the outgoing one laid out of the flow over the incoming
 * one, so both are on screen for the swap) while the step's key flies from its rail card into the
 * step screen's band, and back on return (a shared layout id,
 * `TactileKeys.useSharedKeyId`). Walking between steps inside Layer 2 does
 * not replay it. Under reduced motion the swap is instant and nothing flies.
 *
 * Returning from Layer 2 restores the rail's scroll position (the step screen
 * opens at its head) and puts focus back on the key of the step that was open,
 * once Layer 1 is mounted again, so a reader lands where they left.
 *
 * One time cursor spans both layers (`history/timeTravel`): a past Measure
 * picked on Layer 1's history or on a Gate / Tests strip is the one the other
 * layer shows. Its history is read once Layer 1 has something to paint.
 *
 * Loading: a cold first load ghosts Layer 1 in its real geometry; the Layer-2
 * chunk suspends into a ghost of its hero band (both delayed, so a warm or
 * prefetched load paints neither).
 */
import { memo, Suspense, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { Banner } from '@/features/shared/components/feedback/Banner';
import { KitHost } from '@/features/shared/components/kit';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import type { JourneyNode } from '../journey/journeyModel';
import { LifecycleViewProvider, useLifecycleViewModel } from './context';
import { TimeTravelProvider } from './history/timeTravel';
import { Layer1 } from './layer1/Layer1';
import { Layer1Ghost } from './layer1/Layer1Ghost';
import { LazyStepScreen } from './layer2/lazySteps';
import { arrivedStepChunk } from './layer2/stepChunks';
import { MeasureAnnouncer } from './measure/MeasureAnnouncer';
import { StepScreenGhost } from './layer2/StepScreenGhost';
import { RHYTHM } from './system/lcSurface';
import './layer1/layer1.css';

/** The page's own scroll region: the nearest ancestor that scrolls. */
function scrollRegionOf(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/**
 * Runs `onMount` once its subtree is in the document. A passive effect, so it
 * runs after the page's own layout effect has noted where to return; a press
 * or a key is a discrete event, so React flushes it before the next paint.
 */
function OnMount({ onMount, children }: { onMount: () => void; children: ReactNode }) {
  const ref = useRef(onMount);
  useEffect(() => { ref.current(); }, []);
  return <>{children}</>;
}

const SWAP = { duration: 0.18, ease: [0.22, 1, 0.36, 1] as const };

/**
 * The step screen, rendered straight from its chunk when the chunk is already
 * in (so it mounts in the same commit as the press and the key can fly), else
 * through its lazy component. The choice is made ONCE per mount: switching
 * from the lazy component to the module's own would be a different component
 * type, and React would remount the screen and lose its state.
 */
function ScreenHost({ node }: { node: JourneyNode }) {
  const Direct = useRef(arrivedStepChunk('screen')?.StepScreen ?? null).current;
  return Direct ? <Direct node={node} /> : <LazyStepScreen node={node} />;
}

/** Memoised (no props): it re-renders on the view model, never because the page's shell did. */
export const LifecycleBody = memo(function LifecycleBody() {
  const model = useLifecycleViewModel();
  const { dl, projectId, order, loading, error, refetch, openStepId } = model;
  const reduced = useReducedMotion();
  const open = openStepId ? order.find((n) => n.id === openStepId) ?? null : null;
  const hostRef = useRef<HTMLDivElement>(null);
  const lastOpen = useRef<string | null>(null);
  const returnTo = useRef<string | null>(null);
  // Where the rail was scrolled when a step opened, restored on the way back.
  const railScroll = useRef<{ region: HTMLElement; top: number } | null>(null);

  const restoreRail = () => {
    const back = returnTo.current;
    returnTo.current = null;
    const saved = railScroll.current;
    railScroll.current = null;
    if (saved) saved.region.scrollTop = saved.top;
    if (back) hostRef.current?.querySelector<HTMLElement>(`[data-testid="lc-node-${back}"]`)?.focus({ preventScroll: !!saved });
  };

  // Before paint, so the step screen never shows a frame at the rail's scroll offset.
  useLayoutEffect(() => {
    if (open) {
      if (!lastOpen.current) {
        const region = scrollRegionOf(hostRef.current);
        railScroll.current = region ? { region, top: region.scrollTop } : null;
        if (region) region.scrollTop = 0;
      }
      lastOpen.current = open.id;
      return;
    }
    returnTo.current = lastOpen.current;
    lastOpen.current = null;
    // A return before the rail's own exit finished (Esc pressed at once) gets the SAME rail back,
    // which never remounts: restore it now. A remounted rail is restored by its `OnMount`.
    if (returnTo.current && hostRef.current?.querySelector(`[data-testid="lc-node-${returnTo.current}"]`)) restoreRail();
  }, [open]);

  // The outgoing layer leaves the flow at once (laid over the incoming one at the top of the
  // host), so the two cross-fade in place and the key can fly between them.
  const fade = reduced
    ? { initial: false as const, animate: { opacity: 1 }, exit: { opacity: 1, transition: { duration: 0 } } }
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0, position: 'absolute' as const, top: 0, left: 0, right: 0, pointerEvents: 'none' as const },
        transition: SWAP,
      };

  // Each layer carries the model it was rendered under. The outgoing layer is the element
  // AnimatePresence kept, so it keeps that model while it fades: opening a step does not re-render
  // the whole rail on its way out (nor closing one, the screen), measured with lifecycle-perf.mjs.
  const layer = open ? (
    <motion.div key="l2" {...fade}>
      <LifecycleViewProvider model={model}>
        <Suspense fallback={<StepScreenGhost />}>
          <ScreenHost node={open} />
        </Suspense>
      </LifecycleViewProvider>
    </motion.div>
  ) : order.length > 0 ? (
    <motion.div key="l1" {...fade}>
      <LifecycleViewProvider model={model}>
        <OnMount onMount={restoreRail}><Layer1 /></OnMount>
      </LifecycleViewProvider>
    </motion.div>
  ) : null;

  return (
    <KitHost testId="lc-journey">
      <TimeTravelProvider projectId={projectId} ready={order.length > 0}>
        {/* The Measure's live region: mounted on either layer, under the time cursor. */}
        <MeasureAnnouncer />
        <div ref={hostRef} className={`lcx-inks relative ${RHYTHM.block} pb-6`}>
          {error && <Banner severity="error" compact message={dl.lc_load_failed} cause={error} onRetry={refetch} />}
          {/* The ghost -> Layer 1 swap is a plain conditional (law 2: content is never held, and
              AnimatePresence mounts its first child still); only a press or a return between the
              two layers animates. */}
          {!layer && loading
            ? <Layer1Ghost />
            : <AnimatePresence mode={reduced ? 'wait' : 'sync'} initial={false}>{layer}</AnimatePresence>}
        </div>
      </TimeTravelProvider>
    </KitHost>
  );
});
