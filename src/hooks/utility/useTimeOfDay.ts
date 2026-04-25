import { useEffect, useState } from 'react';

export type TimeOfDay = 'dawn' | 'day' | 'dusk' | 'night';

const PHASE_BOUNDARIES = { dawn: 5, day: 10, dusk: 18, night: 22 } as const;

export function getTimeOfDay(date: Date = new Date()): TimeOfDay {
  const hour = date.getHours();
  if (hour >= PHASE_BOUNDARIES.night || hour < PHASE_BOUNDARIES.dawn) return 'night';
  if (hour < PHASE_BOUNDARIES.day) return 'dawn';
  if (hour < PHASE_BOUNDARIES.dusk) return 'day';
  return 'dusk';
}

export function useTimeOfDay(): TimeOfDay {
  const [phase, setPhase] = useState<TimeOfDay>(() => getTimeOfDay());

  useEffect(() => {
    const tick = () => setPhase((prev) => {
      const next = getTimeOfDay();
      return prev === next ? prev : next;
    });
    const id = setInterval(tick, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  return phase;
}
