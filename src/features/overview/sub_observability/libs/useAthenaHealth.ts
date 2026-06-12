import { useCallback, useEffect, useState } from 'react';
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

  const load = useCallback(() => {
    setLoading(true);
    companionGetHealth(effectiveDays)
      .then((d) => {
        setData(d);
        setError(false);
      })
      .catch((e) => {
        silentCatch('companion_get_health')(e);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [effectiveDays]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, reload: load };
}
