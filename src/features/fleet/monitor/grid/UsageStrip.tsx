// UsageStrip — the band above the project columns that says how much of the
// Claude subscription this fleet has burned, whose logins those are, and —
// once logins are stored — which of up to five plans is live and how the
// others are doing.
//
// THE FRAME (`UsageStripShell`) is a title row, five plan slots, a controls
// row. This file fills the slots:
//   • TITLE RIGHT — refresh, live only once the five-minute cache has
//     elapsed, with the "as of" stamp.
//   • SLOTS — one `PlanCard` per stored login (`AccountRows`), or, while
//     nothing is stored, one card for the live login with a "Store" button
//     on its header. Empty slots keep their width, so the first plan is
//     exactly as wide as the fifth will be.
//   • CONTROLS — the auto-rotate toggle and threshold, the last rotation.
//
// The meters carry two dimensions: the fill is utilisation, the marker is the
// clock warming towards the reset (`usageBits.MeterBar`); the label to their
// left is the whole hours / days left. Nothing is hover-only that matters;
// the exact countdown rides in the accessible label.

import { memo, useCallback, useMemo, useState } from 'react';
import { Plus, RefreshCw, ShieldOff } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { extractMessage } from '@/lib/silentCatch';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AsyncButton } from '@/features/shared/components/buttons';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import type { ClaudeRotationEvent } from '@/lib/bindings/ClaudeRotationEvent';
import { useClaudeUsage, USAGE_CACHE_MS } from './useClaudeUsage';
import { useClaudeAccounts } from './useClaudeAccounts';
import { formatCountdown, orderWindows } from './usageModel';
import { AccountRows, CardMeter } from './AccountRows';
import { EmptySlots, GhostCard, PlanCard, StripFrame } from './UsageStripShell';
import { reasonLabel, useUsageClock } from './usageBits';

export const UsageStrip = memo(function UsageStrip({ enabled = true }: { enabled?: boolean }) {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const now = useUsageClock();

  const onRotated = useCallback(
    (e: ClaudeRotationEvent) =>
      addToast(tx(t.monitor.usage_last_rotation, { from: e.fromEmail, to: e.toEmail }), 'warning'),
    [addToast, tx, t],
  );
  const accounts = useClaudeAccounts(enabled, now, onRotated);
  const stored = accounts.snapshot?.accounts ?? [];
  const multi = stored.length > 0;
  // The single-login read is only needed while nothing is stored; once the
  // multi read carries the live login's usage, this one stops polling.
  const single = useClaudeUsage(enabled && !multi, now);

  const [threshold, setThreshold] = useState<number | null>(null);
  const autoRotate = accounts.snapshot?.autoRotate ?? null;
  const thresholdShown = threshold ?? autoRotate?.thresholdPct ?? 80;

  const saveAutoRotate = useCallback(
    async (enabledNext: boolean, pct: number) => {
      if (!autoRotate) return;
      try {
        await accounts.setAutoRotate({ ...autoRotate, enabled: enabledNext, thresholdPct: pct });
        addToast(enabledNext ? t.monitor.usage_auto_rotate_on : t.monitor.usage_auto_rotate_off, 'success');
      } catch (err) {
        addToast(tx(t.monitor.usage_auto_rotate_failed, { error: extractMessage(err) }), 'error');
      }
    },
    [accounts, autoRotate, addToast, t, tx],
  );

  const capture = useCallback(async () => {
    try {
      const next = await accounts.capture();
      const mine = next.accounts.find((a) => a.id === next.activeAccountId);
      addToast(
        tx(t.monitor.usage_accounts_captured, { email: mine?.email ?? next.liveEmail ?? '', slot: mine?.slot ?? '' }),
        'success',
      );
    } catch (err) {
      addToast(tx(t.monitor.usage_accounts_capture_failed, { error: extractMessage(err) }), 'error');
    }
  }, [accounts, addToast, t, tx]);

  const switchTo = useCallback(
    async (id: string) => {
      try {
        const next = await accounts.switchTo(id);
        const target = next.accounts.find((a) => a.id === id);
        addToast(tx(t.monitor.usage_accounts_switched, { email: target?.email ?? '' }), 'success');
      } catch (err) {
        addToast(tx(t.monitor.usage_accounts_switch_failed, { error: extractMessage(err) }), 'error');
      }
    },
    [accounts, addToast, t, tx],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await accounts.remove(id);
      } catch (err) {
        addToast(tx(t.monitor.usage_accounts_capture_failed, { error: extractMessage(err) }), 'error');
      }
    },
    [accounts, addToast, t, tx],
  );

  const refresh = useCallback(async () => {
    await Promise.all([accounts.refresh(), multi ? Promise.resolve() : single.refresh()]);
  }, [accounts, single, multi]);

  const singleWindows = useMemo(
    () => (single.snapshot?.available ? orderWindows(single.snapshot.windows) : []),
    [single.snapshot],
  );

  const snap = accounts.snapshot;
  const liveUncaptured = snap !== null && !snap.liveCaptured && snap.activeAccountId !== null;
  const storeButton = liveUncaptured ? (
    <Tooltip content={t.monitor.usage_accounts_add_hint}>
      <AsyncButton size="xs" variant="ghost" onClick={capture} data-testid="fleet-usage-capture">
        <Plus className="h-3 w-3" aria-hidden />
        {t.monitor.usage_accounts_add}
      </AsyncButton>
    </Tooltip>
  ) : null;

  // Slots -----------------------------------------------------------------
  let slots: React.ReactNode;
  if (multi) {
    slots = <AccountRows accounts={stored} now={now} onSwitch={switchTo} onRemove={remove} />;
  } else if (!single.snapshot && !single.ipcFailed && !accounts.ipcFailed) {
    slots = (
      <>
        <GhostCard />
        <EmptySlots from={1} />
        <span className="sr-only" role="status">{t.monitor.usage_loading}</span>
      </>
    );
  } else {
    // The live login as the first (and only) card, with Store on its header
    // — the whole "add a plan" flow: sign in with the CLI, and the card
    // notices it is not stored yet.
    const available = single.snapshot?.available ?? false;
    const reason = reasonLabel(t, single.snapshot ? single.snapshot.reason : 'ipc');
    slots = (
      <>
        <PlanCard
          active
          data-testid="fleet-usage-live"
          header={
            <>
              <span className="min-w-0 flex-1 truncate text-foreground" data-testid="fleet-usage-live-email">
                {snap?.liveEmail ?? t.monitor.usage_accounts_active}
              </span>
              {storeButton}
            </>
          }
        >
          {available ? (
            singleWindows.slice(0, 2).map((w) => <CardMeter key={w.key} w={w} now={now} t={t} />)
          ) : (
            <Tooltip content={reason}>
              <span
                className="inline-flex h-[2.25rem] items-center gap-1 typo-caption text-foreground opacity-70"
                data-testid="fleet-usage-unavailable"
                aria-label={`${t.monitor.usage_unavailable}: ${reason}`}
              >
                <ShieldOff className="h-3 w-3" aria-hidden />
                {t.monitor.usage_unavailable}
              </span>
            </Tooltip>
          )}
        </PlanCard>
        <EmptySlots from={1} />
      </>
    );
  }

  // Title right: refresh + stamp ------------------------------------------
  const fetchedAt = multi ? accounts.fetchedAt : (single.fetchedAt ?? accounts.fetchedAt);
  const canRefresh = multi ? accounts.canRefresh : single.canRefresh;
  const waitMs = fetchedAt === null ? 0 : Math.max(0, USAGE_CACHE_MS - (now - fetchedAt));
  const units = {
    day: t.monitor.usage_unit_day,
    hour: t.monitor.usage_unit_hour,
    minute: t.monitor.usage_unit_minute,
    underMinute: t.monitor.usage_under_minute,
  };
  const refreshHint = canRefresh
    ? t.monitor.usage_refresh
    : tx(t.monitor.usage_refresh_wait, { time: formatCountdown(waitMs, units) });
  const titleRight = (
    <>
      {fetchedAt !== null && (
        <span className="whitespace-nowrap">
          {t.monitor.usage_as_of} <RelativeTime timestamp={fetchedAt} />
        </span>
      )}
      <Tooltip content={refreshHint}>
        <AsyncButton
          size="icon-sm"
          variant="ghost"
          disabled={!canRefresh}
          onClick={refresh}
          aria-label={refreshHint}
          data-testid="fleet-usage-refresh"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
        </AsyncButton>
      </Tooltip>
    </>
  );

  // Controls: auto-rotate + last rotation (multi only) ---------------------
  const controls = multi && autoRotate ? (
    <>
      <Tooltip content={t.monitor.usage_auto_rotate_hint}>
        <span className="inline-flex items-center gap-1.5">
          <AccessibleToggle
            size="sm"
            checked={autoRotate.enabled}
            onChange={() => void saveAutoRotate(!autoRotate.enabled, thresholdShown)}
            label={t.monitor.usage_auto_rotate}
          />
          <span>{t.monitor.usage_auto_rotate}</span>
          <input
            type="number"
            min={1}
            max={100}
            step={5}
            value={thresholdShown}
            aria-label={t.monitor.usage_auto_rotate_threshold_aria}
            onChange={(e) => setThreshold(Number(e.target.value))}
            onBlur={() => {
              const pct = Math.max(1, Math.min(100, Math.round(thresholdShown)));
              setThreshold(null);
              if (pct !== autoRotate.thresholdPct) void saveAutoRotate(autoRotate.enabled, pct);
            }}
            className="w-12 rounded-input border border-border bg-background px-1 py-0 text-right typo-caption tabular-nums text-foreground"
            data-testid="fleet-usage-rotate-threshold"
          />
          <span className="opacity-60">%</span>
        </span>
      </Tooltip>
      {liveUncaptured && (
        <span className="inline-flex items-center gap-1 opacity-70">
          <span>{snap?.liveEmail} · {t.monitor.usage_not_stored}</span>
          {storeButton}
        </span>
      )}
      {snap?.lastRotation && (
        <span className="min-w-0 truncate opacity-60">
          {tx(t.monitor.usage_last_rotation, { from: snap.lastRotation.fromEmail, to: snap.lastRotation.toEmail })}
          {' · '}
          <RelativeTime timestamp={snap.lastRotation.atMs} />
        </span>
      )}
    </>
  ) : null;

  return (
    <StripFrame titleRight={titleRight} controls={controls}>
      <div className="contents" data-mode={multi ? 'multi' : 'single'}>{slots}</div>
    </StripFrame>
  );
});

export default UsageStrip;
