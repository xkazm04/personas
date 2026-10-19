import { useCallback, useEffect, useState } from 'react';
import { createLatestWins } from '@/stores/util/latestWins';
import { useOverviewFilterValues } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { llmSpendDashboard } from '@/api/llmSpend';
import type { LlmSpendDashboard } from '@/lib/bindings/LlmSpendDashboard';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Tab-local fetch of the headless LLM spend rollup (`llm_spend_dashboard`),
 * keyed off the same Overview day-range filter the Activity tab uses. Mirrors
 * {@link useAthenaUsage}: not a store slice (Activity-tab-scoped, no cross-surface
 * consumers), and a failed read is reported as `error` (the section renders it
 * as a failure with a retry, never as "no activity") rather than as a toast.
 */
export function useLlmSpend() {
  const { effectiveDays } = useOverviewFilterValues();
  const [data, setData] = useState<LlmSpendDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // One slot per hook instance: a range switched 30d -> 1d while the 30d read
  // is still in flight must not let that slower reply land under the 1d label.
  const [latest] = useState(createLatestWins);

  const load = useCallback(() => {
    const token = latest.next();
    setLoading(true);
    llmSpendDashboard(effectiveDays)
      .then((d) => {
        if (!latest.isCurrent(token)) return;
        setData(d);
        setError(false);
      })
      .catch((e) => {
        silentCatch('llm_spend_dashboard')(e);
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
