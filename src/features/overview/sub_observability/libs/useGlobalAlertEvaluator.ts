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
 *
 * Deliberately NOT routed through `usePolling`/pollingCoordinator visibility
 * gating (long-session hygiene pass, see BackgroundServices): this loop is
 * the client-side half of alert *delivery* — it has to keep evaluating and
 * firing toasts/incidents while the window is minimized, which is exactly the
 * scenario a user configures alerts for. Gating it on `document.hidden` would
 * silently stop notifications the moment the app leaves focus.
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
        // a reload doesn't immediately re-fire. Rules stay TTL-guarded, but
        // history is force-fetched each tick: the Rust alert evaluator (the
        // NOC authority, running even with the UI closed) persists its fires
        // to `fired_alerts`, and only a FRESH history read lets this client
        // loop's cooldown fallback see them — otherwise both loops could
        // fire the same rule inside the TTL window (double toast + double
        // incident). One bounded query per minute — cheap.
        await store.fetchAlertRules(false);
        await store.fetchAlertHistory(true);
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
