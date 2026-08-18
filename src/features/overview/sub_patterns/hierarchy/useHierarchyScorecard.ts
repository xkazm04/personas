// Adherence scorecard fetch — same warm-cache pattern as useHierarchyGraph
// (module-scoped cache keyed by projectId; a remount paints warm; a fetch
// failure keeps the warm copy). The scorecard is an OPTIONAL signal: every
// consumer renders fully with `scorecard === null` or `source.present ===
// false` — that state means "no census signal for this repo", never an error.
import { useEffect, useRef, useState } from 'react';

import { getHierarchyScorecard } from '@/api/devTools/hierarchy';
import type { HierarchyScorecard } from '@/lib/bindings/HierarchyScorecard';
import { silentCatch } from '@/lib/silentCatch';

const scorecardCache = new Map<string, HierarchyScorecard>();

export interface UseHierarchyScorecard {
  /** Warm copy first, revalidated in place. `null` until the first success —
   *  consumers treat that identically to `source.present === false`. */
  scorecard: HierarchyScorecard | null;
  loading: boolean;
}

export function useHierarchyScorecard(projectId: string | null): UseHierarchyScorecard {
  const [scorecard, setScorecard] = useState<HierarchyScorecard | null>(
    projectId ? scorecardCache.get(projectId) ?? null : null,
  );
  const [loading, setLoading] = useState(projectId !== null);
  // Out-of-order guard: a slow response for project A must not land after the
  // user switched to project B.
  const requestSeq = useRef(0);

  useEffect(() => {
    if (!projectId) {
      setScorecard(null);
      setLoading(false);
      return;
    }
    const seq = ++requestSeq.current;
    setScorecard(scorecardCache.get(projectId) ?? null);
    setLoading(true);
    getHierarchyScorecard(projectId)
      .then((sc) => {
        if (requestSeq.current !== seq) return;
        scorecardCache.set(projectId, sc);
        setScorecard(sc);
        setLoading(false);
      })
      .catch((err) => {
        // Optional signal: failure keeps the warm copy (or null) and never
        // blocks the hierarchy UI — the census join is a bonus, not a gate.
        silentCatch('patterns:hierarchyScorecard')(err);
        if (requestSeq.current !== seq) return;
        setLoading(false);
      });
  }, [projectId]);

  return { scorecard, loading };
}
