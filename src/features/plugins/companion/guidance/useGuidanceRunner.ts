import { useEffect, useRef } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { getActiveTranslations } from '@/i18n/useTranslation';
import { useCompanionStore } from '../companionStore';
import { ORB_SIZE } from '../orb/AthenaOrb';
import { resolveWalkthrough } from './walkthroughs';
import { runPreAction } from './appActions';
import type { GuidanceWalkthrough, OrbAnchor } from './types';

const ORB_GAP = 18;
const ANCHOR_WAIT_MS = 4000;
const ANCHOR_POLL_MS = 80;
const SCROLL_SETTLE_MS = 320;

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Poll for `[data-testid="${testId}"]` until present, cancelled, or timed out. */
function waitForTestId(
  testId: string,
  isCancelled: () => boolean,
  timeoutMs = ANCHOR_WAIT_MS,
): Promise<Element | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      if (isCancelled()) return resolve(null);
      const el = document.querySelector(`[data-testid="${testId}"]`);
      if (el) return resolve(el);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(tick, ANCHOR_POLL_MS);
    };
    tick();
  });
}

/** Pick the side with the most room around a target rect. */
function pickSide(r: DOMRect, vw: number, vh: number): Exclude<OrbAnchor, 'auto' | 'center'> {
  const needX = ORB_SIZE + ORB_GAP + 80;
  if (vw - r.right >= needX) return 'right';
  if (r.left >= needX) return 'left';
  if (vh - r.bottom >= ORB_SIZE + ORB_GAP) return 'below';
  return 'above';
}

/** Top-left px the orb should glide to so it parks beside the element. */
function computeOrbTarget(
  el: Element | null,
  anchor: OrbAnchor,
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!el || anchor === 'center') {
    return { left: vw / 2 - ORB_SIZE / 2, top: vh * 0.42 - ORB_SIZE / 2 };
  }
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const side = anchor === 'auto' ? pickSide(r, vw, vh) : anchor;
  switch (side) {
    case 'left':
      return { left: r.left - ORB_GAP - ORB_SIZE, top: cy - ORB_SIZE / 2 };
    case 'above':
      return { left: cx - ORB_SIZE / 2, top: r.top - ORB_GAP - ORB_SIZE };
    case 'below':
      return { left: cx - ORB_SIZE / 2, top: r.bottom + ORB_GAP };
    case 'right':
    default:
      return { left: r.right + ORB_GAP, top: cy - ORB_SIZE / 2 };
  }
}

/** Reading-time estimate for a narration line, clamped to a sane range. */
function defaultDwell(text: string): number {
  return Math.max(3800, Math.min(9000, text.length * 60));
}

/**
 * Drives an active guided walkthrough: for each step it navigates, runs any
 * pre-action, waits for the anchor to mount, rings it with the glow, glides the
 * orb beside it, and auto-advances after a dwell (when playing). The store holds
 * dumb state; this hook owns the registry + per-step orchestration.
 *
 * Mounted once in `AthenaGuideLayer`. Reads only `activeWalkthrough`,
 * `guidanceStepIndex`, and `guidancePlaying` so it re-runs precisely when the
 * step or play/pause changes — never on unrelated companion-store churn.
 */
export function useGuidanceRunner() {
  const activeWalkthrough = useCompanionStore((s) => s.activeWalkthrough);
  const stepIndex = useCompanionStore((s) => s.guidanceStepIndex);
  const playing = useCompanionStore((s) => s.guidancePlaying);
  const adHoc = useCompanionStore((s) => s.adHocWalkthrough);
  const appliedKeyRef = useRef<string | null>(null);
  const lastAdHocRef = useRef<GuidanceWalkthrough | null>(null);
  const clickCleanupRef = useRef<(() => void) | null>(null);

  // Surface the orb when a walkthrough starts (close the panel back to the orb
  // so the demo is visible). No-op if the orb is already showing.
  useEffect(() => {
    if (!activeWalkthrough) return;
    const st = useCompanionStore.getState();
    if (st.state !== 'minimized') st.setState('minimized');
  }, [activeWalkthrough]);

  // Keyboard control while a walkthrough is active: ←/→ step, Esc stop, Space
  // pause/resume. Bound once per walkthrough; reads live state via getState() so
  // it never needs to re-bind on every step. Ignored while the user is typing.
  useEffect(() => {
    if (!activeWalkthrough) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      ) {
        return;
      }
      const store = useCompanionStore.getState();
      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault();
          store.advanceGuidance();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          store.previousGuidance();
          break;
        case 'Escape':
          e.preventDefault();
          store.stopGuidance();
          break;
        case ' ':
        case 'Spacebar':
          e.preventDefault();
          if (store.guidancePlaying) store.pauseGuidance();
          else store.resumeGuidance();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeWalkthrough]);

  useEffect(() => {
    const store = useCompanionStore.getState();

    if (!activeWalkthrough) {
      appliedKeyRef.current = null;
      lastAdHocRef.current = null;
      return;
    }

    // A brand-new ad-hoc walkthrough reuses the same sentinel topic + step 0,
    // so the step key wouldn't change between two consecutive `point_at`s.
    // Reset the applied-key so the new one is treated as a fresh step.
    if (adHoc !== lastAdHocRef.current) {
      lastAdHocRef.current = adHoc;
      appliedKeyRef.current = null;
    }

    const wt = resolveWalkthrough(activeWalkthrough, adHoc);
    if (!wt) {
      store.stopGuidance();
      return;
    }
    if (stepIndex >= wt.steps.length) {
      // Walked off the end — finish (clears highlight + orb target; orb docks).
      store.stopGuidance();
      return;
    }

    const step = wt.steps[stepIndex]!;
    const key = `${activeWalkthrough}:${stepIndex}`;
    const isFreshStep = appliedKeyRef.current !== key;

    let cancelled = false;
    let advanceTimer: ReturnType<typeof setTimeout> | null = null;

    // Clear any prior step's click-to-advance listener before (re)wiring.
    clickCleanupRef.current?.();
    clickCleanupRef.current = null;

    if (isFreshStep) {
      appliedKeyRef.current = key;
      // Clear the prior step's ring immediately for a clean off→navigate→on feel.
      store.setGuidanceHighlightTestId(null);

      void (async () => {
        if (step.navigateRoute) {
          useSystemStore.getState().setSidebarSection(step.navigateRoute);
        }
        if (step.preAction) runPreAction(step.preAction);

        const el = step.highlightTestId
          ? await waitForTestId(step.highlightTestId, () => cancelled)
          : null;
        if (cancelled) return;

        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(SCROLL_SETTLE_MS);
        if (cancelled) return;

        // Re-query post-scroll: the node may have re-rendered into a new element.
        const live = step.highlightTestId
          ? document.querySelector(`[data-testid="${step.highlightTestId}"]`)
          : null;
        const target = live ?? el;

        useCompanionStore.getState().setGuidanceHighlightTestId(step.highlightTestId ?? null);
        useCompanionStore.getState().setOrbGuideTarget(
          computeOrbTarget(target, step.orbAnchor ?? 'auto'),
        );

        // Universal click-to-advance: clicking the thing Athena points at moves
        // the tour on (the glow is pointer-events-none, so the click also hits
        // the real element — "do it and continue"). Capture + once so the
        // element's own handler still runs and we never double-advance.
        if (target) {
          const onClick = () => {
            if (cancelled) return;
            useCompanionStore.getState().advanceGuidance();
          };
          target.addEventListener('click', onClick, { capture: true, once: true });
          clickCleanupRef.current = () =>
            target.removeEventListener('click', onClick, { capture: true });
        }
      })();
    }

    // Auto-advance timer — armed when playing, EXCEPT on a `holdForClick` step
    // that has a real anchor to click (then it waits for the click / Skip). A
    // hold step with no anchor still gets the timer so it can't hard-stall.
    const holding = !!step.holdForClick && !!step.highlightTestId;
    if (playing && !holding) {
      const t = getActiveTranslations();
      const dwell = step.dwellMs ?? defaultDwell(step.narration(t));
      advanceTimer = setTimeout(() => {
        if (cancelled) return;
        useCompanionStore.getState().advanceGuidance();
      }, dwell);
    }

    return () => {
      cancelled = true;
      if (advanceTimer) clearTimeout(advanceTimer);
      clickCleanupRef.current?.();
      clickCleanupRef.current = null;
    };
  }, [activeWalkthrough, stepIndex, playing, adHoc]);
}
