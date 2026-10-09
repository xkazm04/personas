// The Lifecycle journey's data: `getLifecycle(projectId)` with a module-scoped
// warm cache keyed by project (docs/design/overview-loading.md, law 4: the
// lazy route unmounts on nav-away, so a remount paints warm and revalidates),
// refetched whenever a `dev_lifecycle_*` write lands
// (`useDevToolsLiveStore().lifecycleRevision`, bumped by the eventBridge on
// DEV_TOOLS_LIFECYCLE_CHANGED). A failure with a warm copy keeps the copy on
// screen and reports the failure beside it: failure is not empty.
//
// `prefetchLifecycleSnapshot` fills the same cache on intent (the sidebar's
// Lifecycle entry), and a mount that finds that request still in flight joins
// it instead of asking twice.
//
// A refetch that returns the SAME data hands back the SAME object (compared by
// its JSON): most backend events change nothing this page draws, and an
// unchanged object lets React skip the whole page (wave 10, measured with
// scripts/style/lifecycle-perf.mjs).
import { useCallback, useEffect, useRef, useState } from 'react';

import { getLifecycle } from '@/api/devTools/lifecycle';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';
import { resolveError } from '@/lib/errors/errorRegistry';
import { silentCatch } from '@/lib/silentCatch';
import { createLatestWins } from '@/stores/util/latestWins';
import { useDevToolsLiveStore } from '@/stores/devToolsLiveStore';

// One entry per project opened this session; the cap names the bound.
const snapshotCache = createModuleCache<string, LifecycleSnapshot>({ maxSize: 32 });
// Requests in flight, deleted on settle: bounded by the requests open at once.
const inFlight = new Map<string, { revision: number; promise: Promise<LifecycleSnapshot> }>();
// Each cached copy's JSON, so an identical reply keeps the cached object.
const snapshotJson = createModuleCache<string, string>({ maxSize: 32 });
// When each project's copy last arrived, so a hover sweep does not refetch a fresh copy.
const fetchedAt = createModuleCache<string, number>({ maxSize: 32 });
/** An intent prefetch skips a copy younger than this; a mount always revalidates. */
const PREFETCH_FRESH_MS = 15_000;

function loadSnapshot(projectId: string, revision: number, force: boolean): Promise<LifecycleSnapshot> {
  const open = inFlight.get(projectId);
  if (open && !force && open.revision === revision) return open.promise;
  const promise = getLifecycle(projectId).then((s) => {
    fetchedAt.set(projectId, Date.now());
    const json = JSON.stringify(s);
    const kept = snapshotCache.get(projectId);
    if (kept && snapshotJson.get(projectId) === json) return kept;
    snapshotCache.set(projectId, s);
    snapshotJson.set(projectId, json);
    return s;
  });
  const entry = { revision, promise };
  inFlight.set(projectId, entry);
  const settle = () => { if (inFlight.get(projectId) === entry) inFlight.delete(projectId); };
  promise.then(settle, settle);
  return promise;
}

/** Warm a project's snapshot before the page mounts. Quiet: a failure is logged, and the mount retries. */
export function prefetchLifecycleSnapshot(projectId: string): void {
  const at = fetchedAt.get(projectId);
  if (at !== undefined && Date.now() - at < PREFETCH_FRESH_MS) return;
  const revision = useDevToolsLiveStore.getState().lifecycleRevision;
  loadSnapshot(projectId, revision, false).catch(silentCatch('lifecycle:prefetchSnapshot'));
}

export interface UseLifecycleSnapshot {
  /** The freshest snapshot we have: warm cache first, revalidated in place. */
  snapshot: LifecycleSnapshot | null;
  /** A fetch is in flight. The view ghosts only when `loading && !snapshot`. */
  loading: boolean;
  /** The last fetch failure, cleared by the next success. */
  error: string | null;
  refetch: () => void;
}

export function useLifecycleSnapshot(projectId: string | null): UseLifecycleSnapshot {
  const revision = useDevToolsLiveStore((s) => s.lifecycleRevision);
  const [snapshot, setSnapshot] = useState<LifecycleSnapshot | null>(
    projectId ? snapshotCache.get(projectId) ?? null : null,
  );
  const [loading, setLoading] = useState(projectId !== null);
  const [error, setError] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  // A slow response for project A must not land after a switch to project B.
  const latestWins = useRef(createLatestWins()).current;

  // Paint the warm copy immediately on a project switch (not on a revision bump,
  // where the current snapshot is already the right project's).
  useEffect(() => {
    setSnapshot(projectId ? snapshotCache.get(projectId) ?? null : null);
    setError(null);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    const token = latestWins.next();
    setLoading(true);
    // A manual refetch (gen > 0) always asks again; a mount joins a prefetch already on its way.
    loadSnapshot(projectId, revision, gen > 0)
      .then((s) => {
        if (!latestWins.isCurrent(token)) return;
        setSnapshot(s);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!latestWins.isCurrent(token)) return;
        silentCatch('lifecycle:getLifecycle')(err);
        // The page shows this sentence, so it goes through the product's own wording.
        setError(resolveError(err instanceof Error ? err.message : String(err)).message);
        setLoading(false);
      });
  }, [projectId, revision, gen, latestWins]);

  const refetch = useCallback(() => setGen((g) => g + 1), []);

  return { snapshot, loading, error, refetch };
}
