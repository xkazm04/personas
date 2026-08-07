/**
 * One pointer surface, three gestures, discriminated by movement + time.
 *
 *  - **Tap** (down → up, no move, no hold) → opens the full chat panel.
 *  - **Hold** (≥ {@link HOLD_MS} in place) → arms dictation; on release the
 *    transcript fires a voice turn (no panel needed).
 *  - **Drag** (move past {@link DRAG_THRESHOLD}) → relocates the orb; on drop
 *    the X position snaps to the nearest side edge and persists.
 *
 * A drag cancels an armed hold, so moving the orb never accidentally records.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';
import type { HoldToTalk } from '../useHoldToTalk';
import { clamp, MARGIN, ORB_SIZE, type Viewport } from './athenaOrbGeometry';

const HOLD_MS = 220;
const DRAG_THRESHOLD = 6;

export interface OrbGesture {
  /** Transient drag position (px); null when not dragging. */
  dragPx: { left: number; top: number } | null;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: () => void;
  };
}

export function useAthenaOrbGesture(args: {
  talk: HoldToTalk;
  /** Current resolved position (drag position wins upstream). */
  left: number;
  top: number;
  vp: Viewport;
  /** While a walkthrough drives the orb, the user must not fight the glide. */
  guideActive: boolean;
}): OrbGesture {
  const { talk, left, top, vp, guideActive } = args;
  const { start: startTalk, stop: stopTalk, abort: abortTalk } = talk;
  const setOrbPos = useSystemStore((s) => s.setCompanionOrbPos);

  const [dragPx, setDragPx] = useState<{ left: number; top: number } | null>(null);
  const startRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const talkArmedRef = useRef(false);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Ignore non-primary buttons (right-click etc.).
      if (e.button !== 0) return;
      if (guideActive) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      startRef.current = { x: e.clientX, y: e.clientY, left, top };
      draggingRef.current = false;
      talkArmedRef.current = false;
      clearHoldTimer();
      holdTimerRef.current = window.setTimeout(() => {
        holdTimerRef.current = null;
        if (draggingRef.current) return;
        talkArmedRef.current = true;
        startTalk();
      }, HOLD_MS);
    },
    [left, top, clearHoldTimer, startTalk, guideActive],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const start = startRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!draggingRef.current && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        draggingRef.current = true;
        clearHoldTimer();
        if (talkArmedRef.current) {
          abortTalk();
          talkArmedRef.current = false;
        }
      }
      if (!draggingRef.current) return;
      const freeW = Math.max(vp.w - ORB_SIZE, 0);
      const freeH = Math.max(vp.h - ORB_SIZE, 0);
      setDragPx({
        left: clamp(start.left + dx, 0, freeW),
        top: clamp(start.top + dy, 0, freeH),
      });
    },
    [vp.w, vp.h, clearHoldTimer, abortTalk],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch (err) {
        // Capture may already be released (e.g. pointercancel raced us).
        silentCatch('companion_orb_release_capture')(err);
      }
      clearHoldTimer();
      startRef.current = null;

      if (draggingRef.current) {
        // Snap X to the nearer side edge; keep Y where it was dropped.
        const cur = dragPx ?? { left, top };
        const freeW = Math.max(vp.w - ORB_SIZE, 0);
        const freeH = Math.max(vp.h - ORB_SIZE, 0);
        const snappedLeft = cur.left + ORB_SIZE / 2 < vp.w / 2 ? MARGIN : freeW - MARGIN;
        setOrbPos({
          x: freeW > 0 ? snappedLeft / freeW : 1,
          y: freeH > 0 ? clamp(cur.top, MARGIN, freeH - MARGIN) / freeH : 0.82,
        });
        setDragPx(null);
        draggingRef.current = false;
        return;
      }

      if (talkArmedRef.current) {
        stopTalk();
        talkArmedRef.current = false;
        return;
      }

      // Plain tap — open the chat, recording the orb's centre so the panel can
      // morph out from here.
      const store = useCompanionStore.getState();
      store.setOrbOpenOrigin({ x: left + ORB_SIZE / 2, y: top + ORB_SIZE / 2 });
      store.setState('open');
    },
    [dragPx, left, top, vp.w, vp.h, clearHoldTimer, setOrbPos, stopTalk],
  );

  const onPointerCancel = useCallback(() => {
    clearHoldTimer();
    startRef.current = null;
    if (talkArmedRef.current) {
      abortTalk();
      talkArmedRef.current = false;
    }
    setDragPx(null);
    draggingRef.current = false;
  }, [clearHoldTimer, abortTalk]);

  useEffect(() => () => clearHoldTimer(), [clearHoldTimer]);

  return {
    dragPx,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
