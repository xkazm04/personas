// useUsageFeed — the subscription-usage strip's data and verbs, without its
// pixels. PROTOTYPE SEAM lifted from `UsageStrip` so each variant can paint the
// plans in its own language. Switch / remove still go through a ConfirmDialog
// (`dialog`), exactly as `AccountRows` does.

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import type { ClaudeRotationEvent } from '@/lib/bindings/ClaudeRotationEvent';
import { useClaudeUsage, USAGE_CACHE_MS } from '../useClaudeUsage';
import { useClaudeAccounts } from '../useClaudeAccounts';
import { useAutoCapture } from '../useAutoCapture';
import { formatCountdown } from '../usageModel';
import { useUsageActions } from '../usageStripActions';
import { useUsageClock } from '../usageBits';
import { useSimPlans } from '../simulation';
import { useCliUsage } from '../usage/useCliUsage';
import { useResourceModel, type PlanModel } from '../usage/useResourceModel';

type Pending = { kind: 'switch' | 'remove'; plan: PlanModel } | null;

export function useUsageFeed(simulated: boolean) {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const now = useUsageClock();
  const live = !simulated;

  const onRotated = useCallback(
    (e: ClaudeRotationEvent) =>
      addToast(tx(t.monitor.usage_last_rotation, { from: e.fromEmail, to: e.toEmail }), 'warning'),
    [addToast, tx, t],
  );
  const accounts = useClaudeAccounts(live, now, onRotated);
  const actions = useUsageActions(accounts);
  const sim = useSimPlans(simulated);

  const snap = simulated ? sim.snapshot : accounts.snapshot;
  const stored = snap?.accounts ?? [];
  const multi = stored.length > 0;
  const single = useClaudeUsage(live && !multi, now);

  const switchTo = useCallback(
    async (id: string) => (simulated ? sim.switchTo(id) : actions.switchTo(id)),
    [simulated, sim, actions],
  );
  const remove = useCallback(
    async (id: string) => (simulated ? sim.remove(id) : actions.remove(id)),
    [simulated, sim, actions],
  );
  const saveAutoRotate = useCallback(
    (on: boolean, pct: number) => {
      if (!simulated) void actions.saveAutoRotate(on, pct);
      else if (sim.snapshot) sim.setAutoRotate({ ...sim.snapshot.autoRotate, enabled: on, thresholdPct: pct });
    },
    [simulated, sim, actions],
  );

  const liveUncaptured = snap !== null && snap.livePresent && !snap.liveCaptured;
  useAutoCapture({ active: live && liveUncaptured, liveEmail: snap?.liveEmail ?? null, capture: actions.capture });

  const cli = useCliUsage(true, simulated);
  const fetchedAt = multi ? accounts.fetchedAt : (single.fetchedAt ?? accounts.fetchedAt);
  const model = useResourceModel({
    accounts: snap,
    single: simulated ? null : single.snapshot,
    cli: cli.snapshot,
    fetchedAt,
    claudeFailed: !simulated && !single.snapshot && (single.ipcFailed || accounts.ipcFailed),
    now,
  });

  const refresh = useCallback(async () => {
    await Promise.all([accounts.refresh(), multi ? Promise.resolve() : single.refresh(), cli.refresh()]);
  }, [accounts, single, multi, cli]);

  const canRefresh = !simulated && (multi ? accounts.canRefresh : single.canRefresh);
  const units = useMemo(() => ({
    day: t.monitor.usage_unit_day,
    hour: t.monitor.usage_unit_hour,
    minute: t.monitor.usage_unit_minute,
    underMinute: t.monitor.usage_under_minute,
  }), [t]);
  const waitMs = fetchedAt === null ? 0 : Math.max(0, USAGE_CACHE_MS - (now - fetchedAt));
  const refreshHint = canRefresh
    ? t.monitor.usage_refresh
    : tx(t.monitor.usage_refresh_wait, { time: formatCountdown(waitMs, units) });

  // Switch / remove confirmation, identical copy to AccountRows.
  const [pending, setPending] = useState<Pending>(null);
  const ask = useCallback((kind: 'switch' | 'remove', plan: PlanModel) => setPending({ kind, plan }), []);
  const cancel = useCallback(() => setPending(null), []);
  const confirm = useCallback(async () => {
    if (!pending) return;
    try {
      if (pending.kind === 'switch') await switchTo(pending.plan.id);
      else await remove(pending.plan.id);
    } finally {
      setPending(null);
    }
  }, [pending, switchTo, remove]);
  const email = pending?.plan.name ?? '';
  const dialog = pending?.kind === 'switch' ? (
    <ConfirmDialog
      title={tx(t.monitor.usage_accounts_switch_title, { email })}
      body={t.monitor.usage_accounts_switch_body}
      confirmLabel={t.monitor.usage_accounts_switch}
      onConfirm={confirm}
      onCancel={cancel}
    />
  ) : pending?.kind === 'remove' ? (
    <ConfirmDialog
      danger
      title={tx(t.monitor.usage_accounts_remove_title, { email })}
      body={t.monitor.usage_accounts_remove_body}
      onConfirm={confirm}
      onCancel={cancel}
    />
  ) : null;

  return {
    model, now, snapshot: snap, planCount: stored.length,
    autoRotate: snap?.autoRotate ?? null, saveAutoRotate,
    fetchedAt: simulated ? null : fetchedAt, refresh, canRefresh, refreshHint,
    ask, dialog,
  };
}

export type UsageFeed = ReturnType<typeof useUsageFeed>;
