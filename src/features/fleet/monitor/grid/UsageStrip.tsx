// UsageStrip — the band above the project columns that says how much of the
// Claude subscription this fleet has burned, and — once logins are stored —
// which of several plans is live and how the others are doing.
//
// TWO MODES, one chrome.
//   • SINGLE LOGIN (nothing stored): the live login's windows as stacked
//     aligned rows (label · meter · percent · reset · pace), read through
//     `fleet_claude_usage`. Plus one affordance: store this login.
//   • MULTI-PLAN (one or more stored): one row per stored account
//     (`AccountRows`), the active one marked, switchable on click behind a
//     confirm; an auto-rotate toggle with its threshold; the last automatic
//     rotation, if any; and "store this login" again whenever the live login
//     is not among the stored ones.
//
// PACE is a temperature: a flame when utilisation is ahead of the clock, a
// snowflake when it is behind, a gauge when they agree. Nothing on the rows
// is hover-only — the row is the whole story.
//
// Sources: `fleet_claude_usage` (single) and `fleet_claude_accounts_list`
// (multi), both over Anthropic's OAuth endpoints with the CLI's own login;
// see the Rust modules for the trust boundary. An install with no login
// renders one calm chip that says why; it never fakes a meter. Loading paints
// the chrome with static ghost rows under it.

import { memo, useCallback, useMemo, useState } from 'react';
import { Gauge, ShieldOff, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { extractMessage } from '@/lib/silentCatch';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AsyncButton } from '@/features/shared/components/buttons';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import type { ClaudeUsageWindow } from '@/lib/bindings/ClaudeUsageWindow';
import type { ClaudeRotationEvent } from '@/lib/bindings/ClaudeRotationEvent';
import { useClaudeUsage } from './useClaudeUsage';
import { useClaudeAccounts } from './useClaudeAccounts';
import { orderWindows } from './usageModel';
import { AccountRows } from './AccountRows';
import { countdownText, MeterBar, PaceGlyph, reasonLabel, useUsageClock, windowLabel } from './usageBits';

/** One aligned grid for the single-login rows: label · meter · percent · reset · pace. */
const ROW_GRID = 'grid grid-cols-[2.5rem_7rem_2.5rem_minmax(0,1fr)_1rem] items-center gap-x-2';

function MeterRow({ w, now }: { w: ClaudeUsageWindow; now: number }) {
  const { t, tx } = useTranslation();
  return (
    <div className={`${ROW_GRID} h-4`} data-testid="fleet-usage-window" data-window={w.key}>
      <span className="typo-caption text-foreground opacity-70 tabular-nums">{windowLabel(t, w.key)}</span>
      <MeterBar w={w} t={t} />
      <span className="truncate typo-caption text-foreground opacity-60">{countdownText(t, tx, w, now)}</span>
      <PaceGlyph w={w} now={now} t={t} />
    </div>
  );
}

/** Two static row silhouettes, for the first read of the session. */
function GhostRows() {
  const bar = 'rounded bg-primary/[0.06]';
  return (
    <div aria-hidden className="flex flex-col gap-1 animate-fade-in" style={{ animationDelay: '150ms' }}>
      {[0, 1].map((i) => (
        <div key={i} className={`${ROW_GRID} h-4`}>
          <span className={`h-[0.7em] w-5 ${bar} typo-caption`} />
          <span className="h-1.5 w-full rounded-full bg-foreground/10" />
          <span className={`h-[0.7em] w-full ${bar} typo-caption`} />
          <span className={`h-[0.7em] w-24 ${bar} typo-caption`} />
          <span />
        </div>
      ))}
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
  const accounts = useClaudeAccounts(enabled, onRotated);
  const stored = accounts.snapshot?.accounts ?? [];
  const multi = stored.length > 0;
  // The single-login read is only needed while nothing is stored; once the
  // multi read carries the live login's usage, this one stops polling.
  const single = useClaudeUsage(enabled && !multi);

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

  const singleWindows = useMemo(
    () => (single.snapshot?.available ? orderWindows(single.snapshot.windows) : []),
    [single.snapshot],
  );

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

  const liveUncaptured = accounts.snapshot !== null && !accounts.snapshot.liveCaptured && accounts.snapshot.activeAccountId !== null;
  const asOf = multi
    ? accounts.lastRefreshed
    : (single.snapshot?.fetchedAtMs ?? single.lastRefreshed);

  return (
    <div
      role="group"
      aria-label={t.monitor.usage_aria}
      data-testid="fleet-usage-strip"
      data-mode={multi ? 'multi' : 'single'}
      className="flex flex-shrink-0 items-start gap-3 border-b border-border bg-foreground/[0.01] px-3 py-1.5"
    >
      <span className="inline-flex flex-shrink-0 items-center gap-1.5 pt-px typo-caption uppercase tracking-wider text-foreground opacity-70">
        <Gauge className="h-3 w-3" aria-hidden />
        {t.monitor.usage_title}
      </span>

      <div className="min-w-0 flex-1">{body}</div>

      <div className="flex flex-shrink-0 flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          {multi && autoRotate && (
            <Tooltip content={t.monitor.usage_auto_rotate_hint}>
              <span className="inline-flex items-center gap-1.5 typo-caption text-foreground">
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
          {(liveUncaptured || (!multi && accounts.snapshot !== null)) && accounts.snapshot?.activeAccountId && (
            <Tooltip content={t.monitor.usage_accounts_add_hint}>
              <AsyncButton size="xs" variant="ghost" onClick={capture} data-testid="fleet-usage-capture">
                <Plus className="h-3 w-3" aria-hidden />
                {t.monitor.usage_accounts_add}
              </AsyncButton>
            </Tooltip>
          )}
        </div>
        <span className="inline-flex items-center gap-2 whitespace-nowrap typo-caption text-foreground opacity-50">
          {accounts.snapshot?.lastRotation && (
            <span>
              {tx(t.monitor.usage_last_rotation, {
                from: accounts.snapshot.lastRotation.fromEmail,
                to: accounts.snapshot.lastRotation.toEmail,
              })}
              {' · '}
              <RelativeTime timestamp={accounts.snapshot.lastRotation.atMs} />
            </span>
          )}
          {asOf !== null && (
            <span>
              {t.monitor.usage_as_of} <RelativeTime timestamp={asOf} />
            </span>
          )}
        </span>
      </div>
    </div>
  );
});

export default UsageStrip;
