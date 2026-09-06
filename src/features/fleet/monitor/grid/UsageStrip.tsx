// UsageStrip — the band above the project columns that says how much of the
// Claude subscription this fleet has burned, whose login that is, and — once
// logins are stored — which of several plans is live and how the others are.
//
// THE FRAME (`UsageStripShell`) is three rows: the title with the signed-in
// account, the controls, the body. This file fills the slots:
//   • TITLE EXTRA — when the live login is not among the stored plans, the
//     title says so and offers to store it, right beside the email. That is
//     the whole "add a plan" flow: sign in with the CLI, and the strip notices.
//   • CONTROLS — a refresh that is only live once the five-minute cache has
//     elapsed (with the "as of" stamp beside it), the auto-rotate toggle and
//     threshold, and the last automatic rotation.
//   • BODY — meter rows for the single login, or `AccountRows` for several.
//
// The meters carry two dimensions: the fill is utilisation, the marker is the
// clock warming towards the reset (`usageBits.MeterBar`). Nothing on the rows
// is hover-only; the countdown rides in the accessible label.

import { memo, useCallback, useMemo, useState } from 'react';
import { Plus, RefreshCw, ShieldOff } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { extractMessage } from '@/lib/silentCatch';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AsyncButton } from '@/features/shared/components/buttons';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import type { ClaudeUsageWindow } from '@/lib/bindings/ClaudeUsageWindow';
import type { ClaudeRotationEvent } from '@/lib/bindings/ClaudeRotationEvent';
import { useClaudeUsage, USAGE_CACHE_MS } from './useClaudeUsage';
import { useClaudeAccounts } from './useClaudeAccounts';
import { formatCountdown, orderWindows } from './usageModel';
import { AccountRows } from './AccountRows';
import { GhostRows, METER_GRID, StripFrame } from './UsageStripShell';
import { MeterBar, PaceGlyph, reasonLabel, useUsageClock, windowAria, windowLabel } from './usageBits';

function MeterRow({ w, now }: { w: ClaudeUsageWindow; now: number }) {
  const { t, tx } = useTranslation();
  return (
    <div
      className={`${METER_GRID} h-4`}
      data-testid="fleet-usage-window"
      data-window={w.key}
      aria-label={windowAria(t, tx, w, now)}
    >
      <span className="typo-caption text-foreground opacity-70 tabular-nums">{windowLabel(t, w.key)}</span>
      <MeterBar w={w} now={now} t={t} />
      <PaceGlyph w={w} now={now} t={t} />
    </div>
  );
}

function UnavailableChip({ reason }: { reason: string }) {
  const { t } = useTranslation();
  return (
    <Tooltip content={reason}>
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/20 px-2 py-0.5 typo-caption text-foreground"
        data-testid="fleet-usage-unavailable"
        aria-label={`${t.monitor.usage_unavailable}: ${reason}`}
      >
        <ShieldOff className="h-3 w-3 opacity-70" aria-hidden />
        {t.monitor.usage_unavailable}
      </span>
    </Tooltip>
  );
}

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

  // Body -----------------------------------------------------------------
  let body: React.ReactNode;
  if (multi) {
    body = <AccountRows accounts={stored} now={now} onSwitch={switchTo} onRemove={remove} />;
  } else if (!single.snapshot && !single.ipcFailed && !accounts.ipcFailed) {
    body = (
      <>
        <GhostRows />
        <span className="sr-only" role="status">{t.monitor.usage_loading}</span>
      </>
    );
  } else if (!single.snapshot || !single.snapshot.available) {
    body = <UnavailableChip reason={reasonLabel(t, single.snapshot ? single.snapshot.reason : 'ipc')} />;
  } else {
    body = (
      <div className="flex min-w-0 flex-col gap-1">
        {singleWindows.map((w) => <MeterRow key={w.key} w={w} now={now} />)}
      </div>
    );
  }

  // Title ----------------------------------------------------------------
  const snap = accounts.snapshot;
  const activeStored = stored.find((a) => a.isActive) ?? null;
  const email = activeStored?.email ?? snap?.liveEmail ?? null;
  const liveUncaptured = snap !== null && !snap.liveCaptured && snap.activeAccountId !== null;
  const titleExtra = liveUncaptured ? (
    <span className="inline-flex flex-shrink-0 items-center gap-1 typo-caption text-foreground opacity-70">
      <span>· {t.monitor.usage_not_stored}</span>
      <Tooltip content={t.monitor.usage_accounts_add_hint}>
        <AsyncButton size="xs" variant="ghost" onClick={capture} data-testid="fleet-usage-capture">
          <Plus className="h-3 w-3" aria-hidden />
          {t.monitor.usage_accounts_add}
        </AsyncButton>
      </Tooltip>
    </span>
  ) : null;

  // Controls --------------------------------------------------------------
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
  const controls = (
    <>
      <span className="inline-flex items-center gap-1 opacity-70">
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
        {fetchedAt !== null && (
          <span className="whitespace-nowrap">
            {t.monitor.usage_as_of} <RelativeTime timestamp={fetchedAt} />
          </span>
        )}
      </span>
      {multi && autoRotate && (
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
      )}
      {snap?.lastRotation && (
        <span className="min-w-0 truncate opacity-60">
          {tx(t.monitor.usage_last_rotation, { from: snap.lastRotation.fromEmail, to: snap.lastRotation.toEmail })}
          {' · '}
          <RelativeTime timestamp={snap.lastRotation.atMs} />
        </span>
      )}
    </>
  );

  return (
    <StripFrame email={email} titleExtra={titleExtra} controls={controls}>
      <div data-mode={multi ? 'multi' : 'single'}>{body}</div>
    </StripFrame>
  );
});

export default UsageStrip;
