import { useCallback, useEffect, useState } from 'react';
import { useOverviewFilterValues } from '@/features/overview/components/dashboard/OverviewFilterContext';
import { llmSpendDashboard } from '@/api/llmSpend';
import type { LlmSpendDashboard } from '@/lib/bindings/LlmSpendDashboard';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Tab-local fetch of the headless LLM spend rollup (`llm_spend_dashboard`),
 * keyed off the same Overview day-range filter the Activity tab uses. Mirrors
 * {@link useAthenaUsage}: not a store slice (Activity-tab-scoped, no cross-surface
 * consumers), and errors degrade to an empty state rather than a toast.
 */
export function useLlmSpend() {
  const { effectiveDays } = useOverviewFilterValues();
  const [data, setData] = useState<LlmSpendDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    llmSpendDashboard(effectiveDays)
      .then((d) => {
        setData(d);
        setError(false);
      })
      .catch((e) => {
        silentCatch('llm_spend_dashboard')(e);
        setError(true);
      })
      .finally(() => setLoading(false));
  }, [effectiveDays]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, days: effectiveDays, reload: load };
}
