// The Lifecycle journey's data: `getLifecycle(projectId)` with a module-scoped
// warm cache keyed by project (docs/design/overview-loading.md, law 4: the
// lazy route unmounts on nav-away, so a remount paints warm and revalidates),
// refetched whenever a `dev_lifecycle_*` write lands
// (`useDevToolsLiveStore().lifecycleRevision`, bumped by the eventBridge on
// DEV_TOOLS_LIFECYCLE_CHANGED). A failure with a warm copy keeps the copy on
// screen and reports the failure beside it: failure is not empty.
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
    getLifecycle(projectId)
      .then((s) => {
        if (!latestWins.isCurrent(token)) return;
        snapshotCache.set(projectId, s);
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
