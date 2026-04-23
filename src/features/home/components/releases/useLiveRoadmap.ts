/**
 * Hook that fetches the live roadmap once on mount and exposes a manual
 * `refresh()` that forces a re-fetch.
 *
 * Status values:
 * - `loading`      — first fetch in-flight, no data yet.
 * - `fresh`        — payload came from the network this session.
 * - `cached`       — payload came from the Rust disk cache (either because
 *                    it was fresh enough to skip the network, or because the
 *                    network path failed and the cache saved us).
 * - `unavailable`  — no cache AND network failed. Caller falls back to the
 *                    bundled roadmap content.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLiveRoadmap, type LiveRoadmap } from '@/api/liveRoadmap';

export type LiveRoadmapStatus = 'loading' | 'fresh' | 'cached' | 'unavailable';

export interface UseLiveRoadmap {
  roadmap: LiveRoadmap | null;
  fetchedAt: string | null;
  status: LiveRoadmapStatus;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

export function useLiveRoadmap(): UseLiveRoadmap {
  const [roadmap, setRoadmap] = useState<LiveRoadmap | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [status, setStatus] = useState<LiveRoadmapStatus>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (force: boolean) => {
    if (force) setRefreshing(true);
    const result = await fetchLiveRoadmap({ force });
    if (!mounted.current) return;
    if (!result) {
      setStatus((prev) => (prev === 'loading' ? 'unavailable' : prev));
    } else {
      setRoadmap(result.roadmap);
      setFetchedAt(result.fetchedAt);
      setStatus(result.source === 'network' ? 'fresh' : 'cached');
    }
    if (force) setRefreshing(false);
  }, []);

  useEffect(() => {
    void run(false);
  }, [run]);

  const refresh = useCallback(async () => {
    await run(true);
  }, [run]);

  return { roadmap, fetchedAt, status, refreshing, refresh };
}
