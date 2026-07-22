import { useEffect } from 'react';
import { useOverviewStore } from '@/stores/overviewStore';
import { getOverviewBundle } from '@/api/overview/observability';
import { silentCatch } from '@/lib/silentCatch';

/**
 * App-wide alert evaluation. Alerts previously only fired while the Observability
 * tab was open (the only place `evaluateAlertRules` was wired, via
 * useObservabilityData) — so a user who configured alerts but didn't sit on that
 * tab was never notified. This hook lives in BackgroundServices (always mounted)
 * and evaluates on a fixed interval.
 *
 * It fetches its OWN small alert-window snapshot via `getOverviewBundle` and
 * passes it to `evaluateAlertRules(metricsOverride)` rather than writing the
 * shared `observabilityMetrics`, so it never clobbers the range/persona filter
 * the Observability tab is showing.
 */
const ALERT_EVAL_INTERVAL_MS = 60_000;
const ALERT_EVAL_WINDOW_DAYS = 1;

export function useGlobalAlertEvaluator(): void {
  useEffect(() => {
    let cancelled = false;
    let running = false;

    const run = async () => {
      // Guard against overlapping ticks: if a prior pass (rules/history/bundle
      // fetch under a slow backend) is still in flight when the next 60s tick
      // fires, skip it rather than letting two evaluateAlertRules calls race
      // past the cooldown check and double-fire the same alert.
      if (running) return;
      running = true;
      const store = useOverviewStore.getState();
      try {
        // Rules drive what to evaluate; history feeds the cooldown fallback so
        // a reload doesn't immediately re-fire. Both are TTL-guarded → cheap.
        await store.fetchAlertRules(false);
        await store.fetchAlertHistory(false);
        if (cancelled) return;
        const bundle = await getOverviewBundle(ALERT_EVAL_WINDOW_DAYS);
        if (cancelled) return;
        useOverviewStore.getState().evaluateAlertRules({
          summary: bundle.metricsSummary,
          chartData: bundle.metricsChartData,
        });
      } catch (err) {
        if (!cancelled) silentCatch('useGlobalAlertEvaluator')(err);
      } finally {
        running = false;
      }
    };

    void run();
    const id = setInterval(() => void run(), ALERT_EVAL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
}
