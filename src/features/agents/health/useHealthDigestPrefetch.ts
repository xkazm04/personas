import { useEffect, useRef } from 'react';
import { useAgentStore } from "@/stores/agentStore";
import { isTimestampStale } from "@/stores/slices/agents/healthCheckSlice";

const FALLBACK_DELAY_MS = 2000;
const IDLE_TIMEOUT_MS = 2000;

type IdleCb = (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void;
type IdleScheduler = (cb: IdleCb, opts?: { timeout?: number }) => number;

function scheduleIdle(cb: () => void): () => void {
  const g = globalThis as unknown as {
    requestIdleCallback?: IdleScheduler;
    cancelIdleCallback?: (h: number) => void;
  };
  if (typeof g.requestIdleCallback === 'function') {
    const handle = g.requestIdleCallback(() => cb(), { timeout: IDLE_TIMEOUT_MS });
    return () => g.cancelIdleCallback?.(handle);
  }
  const handle = setTimeout(cb, FALLBACK_DELAY_MS);
  return () => clearTimeout(handle);
}

/**
 * Idle-priority prefetch of the agent health digest.
 *
 * The weekly scheduler only fires when a digest is overdue and primarily
 * exists to send a desktop notification — it leaves the in-memory store
 * empty on most launches. This hook fills that gap so the Overview /
 * Health panels open instantly instead of waiting 2–5s for a fresh check.
 *
 * Skip rules: another digest run is in flight, the cached digest is still
 * fresh (<15 min), or this hook has already fired this session.
 */
export function useHealthDigestPrefetch() {
  const ran = useRef(false);
  const personasLoaded = useAgentStore((s) => s.personas.length > 0);

  useEffect(() => {
    if (ran.current || !personasLoaded) return;

    let aborted = false;
    const cancelIdle = scheduleIdle(() => {
      if (aborted || ran.current) return;

      const { healthDigestRunning, lastDigestAt, healthDigest, runFullHealthDigest } =
        useAgentStore.getState();

      if (healthDigestRunning) return;
      if (healthDigest && !isTimestampStale(lastDigestAt)) {
        ran.current = true;
        return;
      }

      ran.current = true;
      void runFullHealthDigest();
    });

    return () => {
      aborted = true;
      cancelIdle();
    };
  }, [personasLoaded]);
}
