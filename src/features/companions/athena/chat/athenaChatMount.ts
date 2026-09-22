/**
 * Two-phase open: paint the frame, then fill it.
 *
 * The interior of the chat is expensive to mount — a transcript of markdown
 * bubbles, the alert stack, the toolbar rail with its connector icons, the
 * Fleet side panel, and a full-panel `<video>` watermark. Mounting all of that
 * in the same task as the frame is what the operator felt as "it lags as it
 * opens": measured warm on an EMPTY conversation, the frame did not paint for
 * 334ms and the main thread was blocked for 257ms of that, so the fly-out had
 * no frames to animate with.
 *
 * The gate is a plain timer set to the morph's own duration, which
 * `usePanelMotion` reports (280ms flying out of the orb, 180ms plain, 120ms
 * under reduced motion). Two earlier designs did not survive measurement:
 *
 *  - **`onAnimationComplete`** looked more honest than a timer, but the app
 *    forces `reducedMotion="always"` whenever the window is backgrounded, and
 *    framer then completes the animation inside the very task that mounted the
 *    frame. The gate opened immediately and the whole open collapsed back into
 *    one ~130ms block with nothing painted before it — the skeleton never
 *    rendered at all.
 *  - **A bare double-rAF** had the same fate for the same reason: the callbacks
 *    were queued during that one long task and flushed against it.
 *
 * So: wait out the animation by the clock, then still take two painted frames
 * before mounting. Nothing behind this gate LISTENS for anything — see
 * `athenaChatEngine` — so a turn landing mid-open is already in the store by
 * the time the transcript exists to show it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ChatMount {
  /** The conversation may mount — transcript, alerts, composer. */
  ready: boolean;
  /**
   * The peripheral chrome may mount — the toolbar rail, the Fleet side panel,
   * and the video watermark.
   *
   * A second wave because the first one still landed as a single ~100ms task,
   * and these three are the parts nobody is waiting on: the watermark is
   * decorative (three `<video>` elements at panel size), and the rail and side
   * panel are glanceable status, not the thing you opened the window for.
   * Splitting them off halves the hitch and puts the conversation up first.
   */
  chromeReady: boolean;
}

export function useChatMount(open: boolean, settleMs: number): ChatMount {
  const [ready, setReady] = useState(false);
  const [chromeReady, setChromeReady] = useState(false);
  const rafRef = useRef<number | null>(null);
  const chromeRafRef = useRef<number | null>(null);

  const cancelRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (chromeRafRef.current !== null) {
      cancelAnimationFrame(chromeRafRef.current);
      chromeRafRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open) {
      cancelRaf();
      setReady(false);
      setChromeReady(false);
      return;
    }
    if (ready) return;
    const id = window.setTimeout(() => {
      // Two real painted frames after the timer, so the interior can never be
      // committed in whatever task the timer happens to land in.
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          setReady(true);
        });
      });
    }, Math.max(settleMs, 32));
    return () => {
      window.clearTimeout(id);
      cancelRaf();
    };
  }, [open, ready, settleMs, cancelRaf]);

  // Second wave — two more painted frames after the conversation is up.
  useEffect(() => {
    if (!ready || chromeReady) return;
    chromeRafRef.current = requestAnimationFrame(() => {
      chromeRafRef.current = requestAnimationFrame(() => {
        chromeRafRef.current = null;
        setChromeReady(true);
      });
    });
    return () => {
      if (chromeRafRef.current !== null) {
        cancelAnimationFrame(chromeRafRef.current);
        chromeRafRef.current = null;
      }
    };
  }, [ready, chromeReady]);

  useEffect(() => cancelRaf, [cancelRaf]);

  return { ready, chromeReady };
}
