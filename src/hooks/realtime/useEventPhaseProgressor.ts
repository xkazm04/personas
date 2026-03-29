import { useEffect, useRef } from 'react';
import type { AnimationPhase, AnimationMap } from '@/hooks/realtime/useRealtimeEvents';

export const PHASE_DURATIONS: Record<AnimationPhase, number> = {
  entering: 300,
  'on-bus': 600,
  delivering: 500,
  done: 1500,
};

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

    function tick() {
      if (stopped) return;

      // Skip ticks when the tab is hidden — no painting happens anyway
      if (document.hidden) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const now = Date.now();
      const map = animationMapRef.current;

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
