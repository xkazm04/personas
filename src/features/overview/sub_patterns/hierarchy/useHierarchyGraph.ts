// Hierarchy graph fetch with a module-scoped warm cache keyed by projectId
// (docs/design/overview-loading.md, law 4: a lazy route fully unmounts on
// nav-away, so a remount must paint warm from the last fetch, then revalidate
// — precedent: sub_lifecycle/LifecyclePage.tsx). A fetch failure with a warm
// copy keeps rendering the warm copy and surfaces the failure honestly —
// failure ≠ empty.
import { useCallback, useEffect, useRef, useState } from 'react';

import { getHierarchyGraph } from '@/api/devTools/hierarchy';
import { corpusRootFor } from '@/features/plugins/dev-tools/sub_workspaces/registry/useRegistryLibrary';
import type { HierarchyGraph } from '@/lib/bindings/HierarchyGraph';
import { silentCatch } from '@/lib/silentCatch';

const graphCache = new Map<string, HierarchyGraph>();

export interface UseHierarchyGraph {
  /** The freshest graph we have — warm cache first, revalidated in place. */
  graph: HierarchyGraph | null;
  /** True while a fetch is in flight. The view ghosts only when
   *  `loading && !graph` (a fetch never hides rendered content — law 1). */
  loading: boolean;
  /** The last fetch failure, cleared by the next success. Rendered as an
   *  honest notice; the warm graph (when present) keeps rendering under it. */
  error: string | null;
  refetch: () => void;
}

export function useHierarchyGraph(projectId: string | null): UseHierarchyGraph {
  // Where the corpus comes from: the workspace's wired registry clone, or the
  // project's own tree when nothing is wired. Part of the CACHE KEY, not just
  // the request — the warm cache is keyed by project, and after the flip the
  // same project can legitimately resolve to a different corpus. Keying on the
  // project alone would paint the old repo's graph after a registry is wired
  // and never revalidate it away.
  const corpusRoot = corpusRootFor(projectId);
  const cacheKey = projectId ? `${projectId}::${corpusRoot ?? 'self'}` : null;

  const [graph, setGraph] = useState<HierarchyGraph | null>(
    cacheKey ? graphCache.get(cacheKey) ?? null : null,
  );
  const [loading, setLoading] = useState(projectId !== null);
  const [error, setError] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  // Guards against a slow response for project A landing after the user
  // switched to project B (the classic out-of-order overwrite).
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!projectId) {
      setGraph(null);
      setLoading(false);
      setError(null);
      return;
    }
    const seq = ++requestSeq.current;
    // Paint warm immediately on a project switch, then revalidate.
    setGraph(cacheKey ? graphCache.get(cacheKey) ?? null : null);
    setLoading(true);
    getHierarchyGraph(projectId, corpusRoot)
      .then((g) => {
        if (requestSeq.current !== seq) return;
        if (cacheKey) graphCache.set(cacheKey, g);
        setGraph(g);
        setError(null);
        setLoading(false);
      })
      .catch((err) => {
        if (requestSeq.current !== seq) return;
        silentCatch('patterns:hierarchyGraph')(err);
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
  }, [projectId, corpusRoot, cacheKey, gen]);

  const refetch = useCallback(() => setGen((g) => g + 1), []);

  return { graph, loading, error, refetch };
}
