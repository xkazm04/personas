import { useCallback, useEffect, useState } from 'react';
import { useOverviewFilterValues } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { companionGetUsageDashboard } from '@/api/companion';
import type { AthenaUsageDashboard } from '@/lib/bindings/AthenaUsageDashboard';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Tab-local fetch of Athena's own usage rollup (`companion_get_usage_dashboard`),
 * keyed off the same Overview day-range filter the Activity tab already uses.
 *
 * Deliberately NOT a store slice — this is Activity-tab-scoped data with no
 * cross-surface consumers (mirrors `useAnnotationData` in sub_observability).
 * Errors degrade to an empty state rather than a toast: Athena usage is a
 * secondary lane, never a reason to break the fleet dashboard.
 */
export function useAthenaUsage() {
  const { effectiveDays } = useOverviewFilterValues();
  const [data, setData] = useState<AthenaUsageDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    companionGetUsageDashboard(effectiveDays)
      .then((d) => {
        setData(d);
        setError(false);
      })
      .catch((e) => {
        silentCatch('companion_get_usage_dashboard')(e);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [effectiveDays]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, days: effectiveDays, reload: load };
}
