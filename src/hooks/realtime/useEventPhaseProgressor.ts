import { useEffect, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AnimationPhase, RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';

export const PHASE_DURATIONS: Record<AnimationPhase, number> = {
  entering: 300,
  'on-bus': 600,
  delivering: 500,
  done: 1500,
};

interface UseEventPhaseProgressorOptions {
  active: boolean;
  setEvents: Dispatch<SetStateAction<RealtimeEvent[]>>;
}

export function useEventPhaseProgressor({ active, setEvents }: UseEventPhaseProgressorOptions) {
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
      setEvents((prev) => {
        if (prev.length === 0) return prev;

        // Read-only pass: check if any event needs a phase transition
        let needsUpdate = false;
        for (const event of prev) {
          const elapsed = now - event._phaseStartedAt;
          if (event._phase === 'done') {
            if (elapsed >= PHASE_DURATIONS.done) { needsUpdate = true; break; }
          } else if (elapsed > PHASE_DURATIONS[event._phase]) {
            needsUpdate = true; break;
          }
        }
        if (!needsUpdate) return prev;

        // Only allocate when something actually changed
        const updated: RealtimeEvent[] = [];
        for (const event of prev) {
          const elapsed = now - event._phaseStartedAt;

          if (event._phase === 'done') {
            if (elapsed < PHASE_DURATIONS.done) updated.push(event);
            continue;
          }

          if (elapsed > PHASE_DURATIONS[event._phase]) {
            const nextPhase: AnimationPhase =
              event._phase === 'entering'
                ? 'on-bus'
                : event._phase === 'on-bus'
                  ? 'delivering'
                  : 'done';
            updated.push({ ...event, _phase: nextPhase, _phaseStartedAt: now });
          } else {
            updated.push(event);
          }
        }

        return updated;
      });

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
  }, [active, setEvents]);
}
