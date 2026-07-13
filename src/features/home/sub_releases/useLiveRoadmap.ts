/**
 * Hook that fetches the live roadmap once on mount and exposes a manual
 * `refresh()` that forces a re-fetch.
 *
 * Status values:
 * - `loading`      — first fetch in-flight, no data yet.
 * - `fresh`        — payload came from the network this session.
 * - `cached`       — payload came from the Rust disk cache because it was
 *                    still fresh enough to skip the network. Healthy path.
 * - `stale`        — payload came from the disk cache as a *rescue* because
 *                    the network attempt failed. Degraded path — the live
 *                    channel is silently broken and the content may be
 *                    out-of-date relative to the server.
 * - `unavailable`  — no cache AND network failed. Caller falls back to the
 *                    bundled roadmap content.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLiveRoadmap, type LiveRoadmap, type LiveRoadmapSource } from '@/api/liveRoadmap';
import { useSystemStore } from '@/stores/systemStore';
import { usePausableInterval } from '../lib/usePausableInterval';

const ROADMAP_POLL_MS = 60 * 60 * 1000;

export type LiveRoadmapStatus = 'loading' | 'fresh' | 'cached' | 'stale' | 'unavailable';

function statusFromSource(source: LiveRoadmapSource): Exclude<LiveRoadmapStatus, 'loading' | 'unavailable'> {
  switch (source) {
    case 'network': return 'fresh';
    case 'cache':   return 'cached';
    case 'stale':   return 'stale';
  }
}

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
      setStatus(statusFromSource(result.source));
    }
    if (force) setRefreshing(false);
  }, []);

  // Initial load on mount.
  useEffect(() => {
    void run(false);
  }, [run]);

  // Poll on the disk-cache cadence so a long-lived home view picks up roadmap
  // updates without a manual refresh — but only while the Roadmap tab is the
  // visible Home tab and the window isn't hidden. Under the keep-alive HomePage
  // this hook's HomeReleases host stays mounted when the user switches away, so
  // an unguarded interval would keep polling off-screen. run(false) only hits
  // the network once the Rust disk cache (1h TTL) has expired, so this is cheap.
  const active = useSystemStore((s) => s.sidebarSection === 'home' && s.homeTab === 'roadmap');
  usePausableInterval(() => void run(false), ROADMAP_POLL_MS, active);

  const refresh = useCallback(async () => {
    await run(true);
  }, [run]);

  return { roadmap, fetchedAt, status, refreshing, refresh };
}
