import { useCallback, useEffect, useRef, useState } from 'react';
import { useOverviewFilterValues } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { companionGetHealth } from '@/api/companion';
import type { AthenaHealth } from '@/lib/bindings/AthenaHealth';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Tab-local fetch of Athena's operational-health snapshot
 * (`companion_get_health`), keyed off the Overview day-range filter. Mirrors
 * `useAthenaUsage` (A3): Observability-tab-scoped, errors degrade to an empty
 * panel rather than a toast.
 */
export function useAthenaHealth() {
  const { effectiveDays } = useOverviewFilterValues();
  const [data, setData] = useState<AthenaHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Bumped on every load() call so a stale in-flight response (e.g. the user
  // switched the day-range filter before the first request resolved) can't
  // clobber state for the range currently being viewed.
  const seqRef = useRef(0);

  const load = useCallback(() => {
    const seq = ++seqRef.current;
    setLoading(true);
    setError(false);
    companionGetHealth(effectiveDays)
      .then((d) => {
        if (seq !== seqRef.current) return;
        setData(d);
        setError(false);
      })
      .catch((e) => {
        if (seq !== seqRef.current) return;
        silentCatch('companion_get_health')(e);
        setError(true);
      })
      .finally(() => {
        if (seq !== seqRef.current) return;
        setLoading(false);
      });
  }, [effectiveDays]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}
