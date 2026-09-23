import { useCallback, useEffect, useRef } from 'react';
import { getMetricsChartData } from '@/api/overview/observability';
import { usePolling } from '@/hooks/utility/timing/usePolling';
import { useSettings } from '@/hooks/utility/data/useSettings';
import { useTranslation } from '@/i18n/useTranslation';
import { storeBus } from '@/lib/storeBus';
import { silentCatch } from '@/lib/silentCatch';
import { NOTIFICATION_PREFS_KEY, parseNotificationPrefs } from '@/lib/notifications/notificationPrefs';
import { useNotificationCenterStore } from '@/stores/notificationCenterStore';
import { useToastStore } from '@/stores/toastStore';
import { CEILING_KEY, MONTHLY_SPEND_DAYS, parseCeiling } from '@/features/settings/sub_limits/components/monthlySpend';
import { readSentBands, recordSentBand, runSpendAlertTick } from '@/features/settings/sub_limits/components/spendAlerts';

/** A full re-check at most this often when nothing has completed. */
const RECHECK_MS = 15 * 60_000;
/** An execution completing asks for a re-check no sooner than this after the last one. */
const MIN_GAP_MS = 60_000;

/**
 * SpendAlertWatcher -- renders nothing.
 *
 * The always-on runner for the monthly spend ceiling's 80% / 100% alerts. The
 * rule lives in `spendAlerts.ts`; it used to run inside the Limits tab, which
 * Settings unmounts 30s after the operator leaves it, so the alert only fired
 * while the operator was already looking at the ceiling. Mounted as an
 * OverlayIsland beside HealingToast, it re-checks on mount, when an execution
 * completes (at most once a minute) and every 15 minutes, and emits the same
 * notification-center row and toast the tab used to, deduped per month by the
 * same ledger.
 */
export function SpendAlertWatcher() {
  const { t } = useTranslation();
  const s = t.settings.limits;
  const { values, loaded } = useSettings([CEILING_KEY, NOTIFICATION_PREFS_KEY]);
  const ceilingRaw = values[CEILING_KEY] ?? null;
  const prefsRaw = values[NOTIFICATION_PREFS_KEY] ?? null;
  const armed = loaded && parseCeiling(ceilingRaw) > 0 && parseNotificationPrefs(prefsRaw).spend_alerts;

  // The checks below outlive a render; they read the latest inputs through this ref.
  const latest = useRef({ ceilingRaw, prefsRaw, s });
  latest.current = { ceilingRaw, prefsRaw, s };
  const lastCheckAt = useRef(0);
  const dirty = useRef(true);

  const check = useCallback(async () => {
    lastCheckAt.current = Date.now();
    dirty.current = false;
    const data = await getMetricsChartData(MONTHLY_SPEND_DAYS);
    const { ceilingRaw: c, prefsRaw: p, s: copy } = latest.current;
    const hit = runSpendAlertTick({ ceilingRaw: c, prefsRaw: p, chartPoints: data.chart_points, alreadySent: readSentBands });
    if (!hit) return;
    recordSentBand(hit.monthKey, hit.band);
    const message = hit.band === 'over' ? copy.over_budget : copy.approaching_budget;
    useNotificationCenterStore.getState().addNotification({
      pipelineId: 0,
      projectId: null,
      status: hit.band === 'over' ? 'failed' : 'warning',
      ref: copy.ceiling_section,
      webUrl: '',
      title: copy.ceiling_section,
      message,
    });
    useToastStore.getState().addToast(message, hit.band === 'over' ? 'error' : 'warning');
  }, []);

  // The shared heartbeat rounds to its 60s bucket; a tick only fetches when a
  // completion asked for it or the 15-minute re-check is due.
  usePolling(
    () => (dirty.current || Date.now() - lastCheckAt.current >= RECHECK_MS ? check() : undefined),
    { interval: MIN_GAP_MS, enabled: armed, name: 'spend-alert-watcher' },
  );

  useEffect(() => {
    if (!armed) return;
    return storeBus.on('execution:completed', () => {
      if (Date.now() - lastCheckAt.current < MIN_GAP_MS) {
        dirty.current = true; // the next heartbeat picks it up
        return;
      }
      check().catch(silentCatch('overview/SpendAlertWatcher:executionCompleted'));
    });
  }, [armed, check]);

  return null;
}
