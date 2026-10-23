import { useCallback, useEffect, useRef, useState } from 'react';
import { useOverviewFilterValues } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { companionGetHealth } from '@/api/companion';
import type { AthenaHealth } from '@/lib/bindings/AthenaHealth';
import { silentCatch } from '@/lib/silentCatch';
import { createLatestWins } from '@/stores/util/latestWins';

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
  // A token per load() call so a stale in-flight response (e.g. the user
  // switched the day-range filter before the first request resolved) can't
  // clobber state for the range currently being viewed.
  const latest = useRef(createLatestWins()).current;

  const load = useCallback(() => {
    const seq = latest.next();
    setLoading(true);
    setError(false);
    companionGetHealth(effectiveDays)
      .then((d) => {
        if (!latest.isCurrent(seq)) return;
        setData(d);
        setError(false);
      })
      .catch((e) => {
        if (!latest.isCurrent(seq)) return;
        silentCatch('companion_get_health')(e);
        // The previous range's snapshot is not this range's answer: drop it, so a failed
        // reload reads as failed instead of as the old window's numbers.
        setData(null);
        setError(true);
      })
      .finally(() => {
        if (!latest.isCurrent(seq)) return;
        setLoading(false);
      });
  }, [effectiveDays, latest]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}
