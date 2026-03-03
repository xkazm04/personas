import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AnimationPhase, RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';

export const PHASE_DURATIONS: Record<AnimationPhase, number> = {
  entering: 400,
  'on-bus': 800,
  delivering: 600,
  done: 2000,
};

interface UseEventPhaseProgressorOptions {
  active: boolean;
  setEvents: Dispatch<SetStateAction<RealtimeEvent[]>>;
}

export function useEventPhaseProgressor({ active, setEvents }: UseEventPhaseProgressorOptions) {
  useEffect(() => {
    if (!active) return;

    const timer = setInterval(() => {
      const now = Date.now();
      setEvents((prev) => {
        if (prev.length === 0) return prev;

        let changed = false;
        const updated: RealtimeEvent[] = [];

        for (const event of prev) {
          const elapsed = now - event._phaseStartedAt;

          if (event._phase === 'done') {
            if (elapsed < PHASE_DURATIONS.done) {
              updated.push(event);
            } else {
              changed = true;
            }
            continue;
          }

          const phaseDuration = PHASE_DURATIONS[event._phase];
          if (elapsed > phaseDuration) {
            const nextPhase: AnimationPhase =
              event._phase === 'entering'
                ? 'on-bus'
                : event._phase === 'on-bus'
                  ? 'delivering'
                  : 'done';
            updated.push({ ...event, _phase: nextPhase, _phaseStartedAt: now });
            changed = true;
          } else {
            updated.push(event);
          }
        }

        return changed ? updated : prev;
      });
    }, 100);

    return () => clearInterval(timer);
  }, [active, setEvents]);
}
