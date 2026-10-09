// The project's Measure history (`getLifecycleHistory`: gate and tests as
// judged at each of the newest 20 Measures, with their runs), cached the way
// the snapshot and the step detail are (docs/design/overview-loading.md,
// law 4): a module-scoped warm cache keyed by project, refetched whenever a
// `dev_lifecycle_*` write lands (`lifecycleRevision`), latest-wins across a
// project switch, a failure that keeps any warm copy on screen.
//
// The FIRST read of a project is deferred to an idle slice and only starts
// once Layer 1 has something to paint (`enabled`), so the history never
// competes with the snapshot the rail is waiting on. A revalidation (a
// revision bump, a retry) asks at once: there is already a copy on screen.
//
// `prefetchLifecycleHistory` fills the same cache on intent (a pointer resting
// on Gate's or Tests' key, whose screens draw the history as a strip), and a
// mount that finds that request in flight joins it instead of asking twice.
import { useCallback, useEffect, useRef, useState } from 'react';

import { getLifecycleHistory } from '@/api/devTools/lifecycle';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import { idlePrefetch } from '@/lib/idlePrefetch';
import type { LifecycleHistory } from '@/lib/bindings/LifecycleHistory';
import { resolveError } from '@/lib/errors/errorRegistry';
import { silentCatch } from '@/lib/silentCatch';
import { useDevToolsLiveStore } from '@/stores/devToolsLiveStore';
import { createLatestWins } from '@/stores/util/latestWins';

// One entry per project opened this session; the cap names the bound.
const historyCache = createModuleCache<string, LifecycleHistory>({ maxSize: 32 });
// Each cached copy's JSON: a reread that returns the same history keeps the cached object, so a
// revision that changed nothing here re-renders nothing that reads it.
const historyJson = createModuleCache<string, string>({ maxSize: 32 });
// Requests in flight, deleted on settle: bounded by the requests open at once.
const inFlight = new Map<string, { revision: number; promise: Promise<LifecycleHistory> }>();

const EMPTY: LifecycleHistory = { measures: [], stepIds: [] };

function loadHistory(projectId: string, revision: number, force: boolean): Promise<LifecycleHistory> {
  const open = inFlight.get(projectId);
  if (open && !force && open.revision === revision) return open.promise;
  // Through a promise, so a throw inside the call lands as a rejection the caller handles.
  // A reply without measures (a test double that answers nothing) reads as an empty history.
  const promise = Promise.resolve()
    .then(() => getLifecycleHistory(projectId))
    .then((h) => {
      const history = h?.measures ? h : EMPTY;
      const json = JSON.stringify(history);
      const kept = historyCache.get(projectId);
      if (kept && historyJson.get(projectId) === json) return kept;
      historyCache.set(projectId, history);
      historyJson.set(projectId, json);
      return history;
    });
  const entry = { revision, promise };
  inFlight.set(projectId, entry);
  const settle = () => { if (inFlight.get(projectId) === entry) inFlight.delete(projectId); };
  promise.then(settle, settle);
  return promise;
}

/** Warm a project's history before a screen that draws it opens. Quiet: a failure is logged, and the mount retries. */
export function prefetchLifecycleHistory(projectId: string): void {
  if (historyCache.get(projectId) || inFlight.has(projectId)) return;
  const revision = useDevToolsLiveStore.getState().lifecycleRevision;
  loadHistory(projectId, revision, false).catch(silentCatch('lifecycle:prefetchHistory'));
}

/** The warm copy, if any (for a ghost decision before the hook's first effect). */
export function cachedLifecycleHistory(projectId: string | null): LifecycleHistory | null {
  return projectId ? historyCache.get(projectId) ?? null : null;
}

export interface UseLifecycleHistory {
  history: LifecycleHistory | null;
  /** A read is pending (idle wait included). A view ghosts only when `loading && !history`. */
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useLifecycleHistory(projectId: string | null, enabled = true): UseLifecycleHistory {
  const revision = useDevToolsLiveStore((s) => s.lifecycleRevision);
  const [history, setHistory] = useState<LifecycleHistory | null>(() => cachedLifecycleHistory(projectId));
  const [loading, setLoading] = useState(projectId !== null);
  const [error, setError] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  // A slow answer for project A must not land after a switch to project B.
  const latestWins = useRef(createLatestWins()).current;

  useEffect(() => {
    setHistory(cachedLifecycleHistory(projectId));
    setError(null);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    if (!enabled) return;
    const token = latestWins.next();
    setLoading(true);
    const run = () => loadHistory(projectId, revision, gen > 0)
      .then((h) => {
        if (!latestWins.isCurrent(token)) return;
        setHistory(h);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!latestWins.isCurrent(token)) return;
        silentCatch('lifecycle:getLifecycleHistory')(err);
        setError(resolveError(err instanceof Error ? err.message : String(err)).message);
        setLoading(false);
      });
    // Cold: wait for an idle slice after Layer 1 painted. Warm, joining, or a retry: now.
    const cold = !historyCache.get(projectId) && !inFlight.has(projectId) && gen === 0;
    if (!cold) {
      void run();
      return;
    }
    return idlePrefetch([run]);
  }, [projectId, revision, gen, enabled, latestWins]);

  const refetch = useCallback(() => setGen((g) => g + 1), []);
  return { history, loading, error, refetch };
}

/** Test-only: forget every cached and in-flight history. */
export function __resetHistoryCacheForTests(): void {
  historyCache.clear();
  historyJson.clear();
  inFlight.clear();
}
