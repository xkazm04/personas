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
    const outcome = await fetchLiveRoadmap({ force });
    if (!mounted.current) return;
    if (!outcome.ok) {
      // A failed fetch is not a no-op for the freshness pill. With content
      // already on screen the previous status ('fresh' / 'cached') would keep
      // claiming a healthy live channel: a manual refresh spins, settles, and
      // leaves the same green dot and the same timestamp -- indistinguishable
      // from a refresh that succeeded and found nothing new. 'stale' is
      // precisely this state ("what you are reading came from the cache
      // because the network attempt failed"), and the pill already renders it
      // as a red dot with the offline-snapshot label. 'unavailable' (bundled
      // fallback, nothing to be stale about) stays as it is.
      //
      // `outcome.failure` says WHY. The pill's posture is deliberately the same
      // for every kind — from the reader's side a stale roadmap is a stale
      // roadmap — but a STRUCTURAL failure (schema drift: permanent, silent,
      // and identical on screen to a train tunnel) is reported to Sentry at the
      // API boundary that holds the evidence, so it is no longer invisible to
      // monitoring just because the UI has nothing different to say about it.
      setStatus((prev) =>
        prev === 'loading' ? 'unavailable' : prev === 'unavailable' ? prev : 'stale',
      );
    } else {
      setRoadmap(outcome.result.roadmap);
      setFetchedAt(outcome.result.fetchedAt);
      setStatus(statusFromSource(outcome.result.source));
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
