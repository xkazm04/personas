// One step's Layer-2 data (`getLifecycleStepDetail`: run history, doc rows)
// with a module-scoped warm cache keyed by project and step, the same shape
// as `useLifecycleSnapshot` (docs/design/overview-loading.md, law 4: walking
// back to a step paints warm and revalidates). Refetched whenever a
// `dev_lifecycle_*` write lands (`lifecycleRevision`). A failure keeps any
// warm copy on screen and reports itself beside it.
//
// `prefetchStepDetail` fills the same cache on intent (a pointer resting on a
// step's key), and a mount that finds that request still in flight joins it
// instead of asking twice.
import { useCallback, useEffect, useRef, useState } from 'react';

import { getLifecycleStepDetail } from '@/api/devTools/lifecycle';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import type { LifecycleStepDetail } from '@/lib/bindings/LifecycleStepDetail';
import { resolveError } from '@/lib/errors/errorRegistry';
import { silentCatch } from '@/lib/silentCatch';
import { useDevToolsLiveStore } from '@/stores/devToolsLiveStore';
import { createLatestWins } from '@/stores/util/latestWins';

// One entry per (project, step) opened this session; eleven steps a project, so the cap names the bound.
const detailCache = createModuleCache<string, LifecycleStepDetail>({ maxSize: 64 });
// Requests in flight, deleted on settle: bounded by the requests open at once.
const inFlight = new Map<string, { revision: number; promise: Promise<LifecycleStepDetail> }>();

const keyOf = (projectId: string, stepId: string) => `${projectId}:${stepId}`;

/** Fetch into the cache, joining a request for the same data revision that is already in flight. */
function loadDetail(projectId: string, stepId: string, revision: number, force: boolean): Promise<LifecycleStepDetail> {
  const key = keyOf(projectId, stepId);
  const open = inFlight.get(key);
  if (open && !force && open.revision === revision) return open.promise;
  const promise = getLifecycleStepDetail(projectId, stepId).then((d) => {
    detailCache.set(key, d);
    return d;
  });
  const entry = { revision, promise };
  inFlight.set(key, entry);
  const settle = () => { if (inFlight.get(key) === entry) inFlight.delete(key); };
  promise.then(settle, settle);
  return promise;
}

/** Warm a step's detail before its screen opens. Quiet: a failure is logged, and the mount retries. */
export function prefetchStepDetail(projectId: string, stepId: string): void {
  if (detailCache.get(keyOf(projectId, stepId))) return;
  const revision = useDevToolsLiveStore.getState().lifecycleRevision;
  loadDetail(projectId, stepId, revision, false).catch(silentCatch('lifecycle:prefetchStepDetail'));
}

export interface UseStepDetail {
  detail: LifecycleStepDetail | null;
  /** A fetch is in flight. A preset ghosts only when `loading && !detail`. */
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/** `stepId` null = this step needs no detail (its preset reads the snapshot only). */
export function useStepDetail(projectId: string | null, stepId: string | null): UseStepDetail {
  const revision = useDevToolsLiveStore((s) => s.lifecycleRevision);
  const key = projectId && stepId ? keyOf(projectId, stepId) : null;
  const [detail, setDetail] = useState<LifecycleStepDetail | null>(key ? detailCache.get(key) ?? null : null);
  const [loading, setLoading] = useState(key !== null);
  const [error, setError] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  // A slow answer for step A must not land after a walk to step B.
  const latestWins = useRef(createLatestWins()).current;

  useEffect(() => {
    setDetail(key ? detailCache.get(key) ?? null : null);
    setError(null);
  }, [key]);

  useEffect(() => {
    if (!projectId || !stepId || !key) {
      setLoading(false);
      return;
    }
    const token = latestWins.next();
    setLoading(true);
    // A manual retry (gen > 0) always asks again; a mount joins a prefetch already on its way.
    loadDetail(projectId, stepId, revision, gen > 0)
      .then((d) => {
        if (!latestWins.isCurrent(token)) return;
        setDetail(d);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!latestWins.isCurrent(token)) return;
        silentCatch('lifecycle:getLifecycleStepDetail')(err);
        setError(resolveError(err instanceof Error ? err.message : String(err)).message);
        setLoading(false);
      });
  }, [projectId, stepId, key, revision, gen, latestWins]);

  const refetch = useCallback(() => setGen((g) => g + 1), []);
  return { detail, loading, error, refetch };
}
