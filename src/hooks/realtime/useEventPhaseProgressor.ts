import { useEffect, useRef } from 'react';
import type { AnimationPhase, AnimationMap } from '@/hooks/realtime/useRealtimeEvents';

export const PHASE_DURATIONS: Record<AnimationPhase, number> = {
  entering: 300,
  'on-bus': 600,
  delivering: 500,
  done: 1500,
};

/** Maximum animation entries allowed — safety valve against unbounded growth */
const MAX_ANIMATION_ENTRIES = 200;

/** Total duration of all phases — entries older than this are certainly stale */
const TOTAL_PHASE_DURATION =
  PHASE_DURATIONS.entering +
  PHASE_DURATIONS['on-bus'] +
  PHASE_DURATIONS.delivering +
  PHASE_DURATIONS.done;

interface UseEventPhaseProgressorOptions {
  active: boolean;
  animationMapRef: React.RefObject<AnimationMap>;
  onTick: React.Dispatch<React.SetStateAction<number>>;
}

export function useEventPhaseProgressor({ active, animationMapRef, onTick }: UseEventPhaseProgressorOptions) {
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;

    let stopped = false;
    let wasHidden = document.hidden;

    function tick() {
      if (stopped) return;

      // Skip ticks when the tab is hidden — no painting happens anyway
      if (document.hidden) {
        wasHidden = true;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const now = Date.now();
      const map = animationMapRef.current;

      // On tab restore, purge stale entries that accumulated while hidden
      // instead of bulk-advancing them (which would cause a visible freeze).
      if (wasHidden && map.size > 0) {
        wasHidden = false;
        const staleKeys: string[] = [];
        for (const [key, anim] of map) {
          if (now - anim.phaseStartedAt > TOTAL_PHASE_DURATION) {
            staleKeys.push(key);
          }
        }
        if (staleKeys.length > 0) {
          for (const key of staleKeys) {
            map.delete(key);
          }
          onTick((t) => t + 1);
        }
      }

      // Safety cap: if the map somehow exceeds the limit, drop oldest entries
      if (map.size > MAX_ANIMATION_ENTRIES) {
        const entries = [...map.entries()].sort(
          (a, b) => a[1].phaseStartedAt - b[1].phaseStartedAt
        );
        const excess = map.size - MAX_ANIMATION_ENTRIES;
        for (let i = 0; i < excess; i++) {
          map.delete(entries[i]![0]);
        }
      }

      if (map.size === 0) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Check if any animation needs a phase transition
      let needsUpdate = false;
      const toDelete: string[] = [];

      for (const [key, anim] of map) {
        const elapsed = now - anim.phaseStartedAt;
        if (anim.phase === 'done') {
          if (elapsed >= PHASE_DURATIONS.done) {
            toDelete.push(key);
            needsUpdate = true;
          }
        } else if (elapsed > PHASE_DURATIONS[anim.phase]) {
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        // Remove expired 'done' entries
        for (const key of toDelete) {
          map.delete(key);
        }

        // Advance phases in-place
        for (const anim of map.values()) {
          if (anim.phase === 'done') continue;
          const elapsed = now - anim.phaseStartedAt;
          if (elapsed > PHASE_DURATIONS[anim.phase]) {
            anim.phase =
              anim.phase === 'entering'
                ? 'on-bus'
                : anim.phase === 'on-bus'
                  ? 'delivering'
                  : 'done';
            anim.phaseStartedAt = now;
          }
        }

        // Bump the tick counter to notify React consumers
        onTick((t) => t + 1);
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      stopped = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [active, animationMapRef, onTick]);
}
