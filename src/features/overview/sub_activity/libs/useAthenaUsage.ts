import { useCallback, useEffect, useState } from 'react';
import { createLatestWins } from '@/stores/util/latestWins';
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
 * Errors are reported as `error`, never as a toast: Athena usage is a
 * secondary lane, never a reason to break the fleet dashboard. The section
 * renders it as a failure with a retry, not as "Athena did nothing".
 */
export function useAthenaUsage() {
  const { effectiveDays } = useOverviewFilterValues();
  const [data, setData] = useState<AthenaUsageDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // One slot per hook instance: a range switched 30d -> 1d while the 30d read
  // is still in flight must not let that slower reply land under the 1d label.
  const [latest] = useState(createLatestWins);

  const load = useCallback(() => {
    const token = latest.next();
    setLoading(true);
    companionGetUsageDashboard(effectiveDays)
      .then((d) => {
        if (!latest.isCurrent(token)) return;
        setData(d);
        setError(false);
      })
      .catch((e) => {
        silentCatch('companion_get_usage_dashboard')(e);
        if (!latest.isCurrent(token)) return;
        setError(true);
      })
      .finally(() => {
        if (latest.isCurrent(token)) setLoading(false);
      });
  }, [effectiveDays, latest]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, days: effectiveDays, reload: load };
}
