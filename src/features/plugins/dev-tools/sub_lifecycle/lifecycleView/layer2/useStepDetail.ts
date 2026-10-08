// One step's Layer-2 data (`getLifecycleStepDetail`: run history, doc rows)
// with a module-scoped warm cache keyed by project and step, the same shape
// as `useLifecycleSnapshot` (docs/design/overview-loading.md, law 4: walking
// back to a step paints warm and revalidates). Refetched whenever a
// `dev_lifecycle_*` write lands (`lifecycleRevision`). A failure keeps any
// warm copy on screen and reports itself beside it.
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

const keyOf = (projectId: string, stepId: string) => `${projectId}:${stepId}`;

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
    getLifecycleStepDetail(projectId, stepId)
      .then((d) => {
        if (!latestWins.isCurrent(token)) return;
        detailCache.set(key, d);
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
