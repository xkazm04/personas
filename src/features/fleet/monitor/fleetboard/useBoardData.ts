// useBoardData — the two things the Board measures or fetches for itself:
// the field's size (the layout is a pure function of it) and the 24h runs per
// persona that the large tiles draw as a sparkline.

import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';
import { getPersonaRunsHourly } from '@/api/agents/personas';
import { POLLING_CONFIG, usePolling } from '@/hooks/utility/timing/usePolling';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';

export interface Size { w: number; h: number }

/** The element's content-box size, kept current by a ResizeObserver. */
export function useElementSize(ref: RefObject<HTMLElement | null>): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (w: number, h: number) =>
      setSize((s) => (Math.abs(s.w - w) < 0.5 && Math.abs(s.h - h) < 0.5 ? s : { w, h }));
    read(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver(([entry]) => {
      if (entry) read(entry.contentRect.width, entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

/** Hours in the sparkline window. */
export const HOURLY_WINDOW = 24;

export type HourlyRuns = ReadonlyMap<string, readonly number[]>;
const NO_RUNS: HourlyRuns = new Map();

// One entry (the fleet's last read), kept across Monitor opens so a re-open
// draws the last-known sparklines in frame one (loading pattern v2: a fetch
// never hides what is already drawn).
const hourlyStore = createModuleCache<'fleet', HourlyRuns>({ maxSize: 1 });

/**
 * Runs per hour for the last 24 hours, keyed by persona id; a persona with no
 * runs is absent and reads as all zeros. Fetched when the Board opens and on
 * the dashboards' 30s cadence after that (the shared PollingCoordinator, which
 * also pauses it while the window is hidden).
 */
export function useHourlyRuns(enabled: boolean): HourlyRuns {
  const [runs, setRuns] = useState<HourlyRuns>(() => hourlyStore.get('fleet') ?? NO_RUNS);
  const read = useCallback(async () => {
    const rows = await getPersonaRunsHourly(HOURLY_WINDOW);
    const next: HourlyRuns = new Map(rows.map((r) => [r.personaId, r.buckets]));
    hourlyStore.set('fleet', next);
    setRuns(next);
  }, []);
  usePolling(read, {
    interval: POLLING_CONFIG.dashboardRefresh.interval,
    maxBackoff: POLLING_CONFIG.dashboardRefresh.maxBackoff,
    enabled,
    name: 'monitor-board-hourly',
  });
  return enabled ? runs : NO_RUNS;
}
