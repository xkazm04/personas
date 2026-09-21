// UsageStrip — the band above the project columns that says how much of each
// coding subscription this fleet has burned, and whose logins those are: ONE ROW
// PER ACCOUNT, across Claude, Codex and Grok.
//
// THE FRAME (`UsageStripShell`) is a permanent header and a grid of rows. This
// file decides what goes in each:
//   • HEADER LEFT — the title and the stored-plan count (the frame's own).
//   • HEADER RIGHT — `UsageStripControls` (auto-rotate, threshold, last
//     rotation) once anything is stored, then refresh with its "as of" stamp,
//     live only once the five-minute cache has elapsed.
//   • ROWS — `AccountRows`, fed by ONE joined `ResourceModel`
//     (`usage/useResourceModel`): every stored Claude plan (or, while nothing is
//     stored, the single live login as one row of the same component), then the
//     read-only Codex / Grok usage (`usage/useCliUsage`). A read that has not
//     settled is a ghost row under the header — never a spinner.
//
// THERE IS ONE LAYOUT. The strip was a five-variant prototype host for a round;
// the variants were deleted and the switcher with them. A layout name a browser
// profile still holds under `monitor.usage.variant` is read by nothing.
//
// STORING IS AUTOMATIC. When the backend reports a live login that is not one
// of the stored plans, `useAutoCapture` stores it — once per login, never in
// a loop — and the strip shows the stored plan on the snapshot that comes back.
// Forget stays manual.
//
// The acts live in `usageStripActions`; the meters' arithmetic in `usageModel`.
//
// SIMULATION. With `simulated`, every read is switched off (`enabled` goes
// false, so no poll runs, and the auto-capture is inert) and the strip renders
// `useSimPlans` — five plans covering every branch a row can take, including
// the projected, the unreadable and the quarantined — beside a simulated Codex
// (one window) and a not-installed Grok (`buildSimCliUsage`). The switch, the
// forget and the auto-rotate control stay wired; they land in that state
// instead of in the backend, so each flow can be walked with its real confirm
// dialog.

import { memo, useCallback, useMemo } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AsyncButton } from '@/features/shared/components/buttons';
import type { ClaudeRotationEvent } from '@/lib/bindings/ClaudeRotationEvent';
import { useClaudeUsage, USAGE_CACHE_MS } from './useClaudeUsage';
import { useClaudeAccounts } from './useClaudeAccounts';
import { useAutoCapture } from './useAutoCapture';
import { formatCountdown } from './usageModel';
import { AccountRows } from './AccountRows';
import { StripFrame } from './UsageStripShell';
import { UsageStripControls } from './UsageStripControls';
import { useUsageActions } from './usageStripActions';
import { useUsageClock } from './usageBits';
import { useSimPlans } from './simulation';
import { useCliUsage } from './usage/useCliUsage';
import { useResourceModel } from './usage/useResourceModel';

export const UsageStrip = memo(function UsageStrip({
  enabled = true, simulated = false,
}: {
  enabled?: boolean;
  simulated?: boolean;
}) {
  const { t, tx } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const now = useUsageClock();
  const live = enabled && !simulated;

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
  // The single-login read is only needed while nothing is stored; once the
  // multi read carries the live login's usage, this one stops polling.
  const single = useClaudeUsage(live && !multi, now);

  const onSwitch = useCallback(
    async (id: string) => (simulated ? sim.switchTo(id) : actions.switchTo(id)),
    [simulated, sim, actions],
  );
  const onRemove = useCallback(
    async (id: string) => (simulated ? sim.remove(id) : actions.remove(id)),
    [simulated, sim, actions],
  );
  const onSaveRotate = useCallback(
    (on: boolean, pct: number) => {
      if (!simulated) {
        void actions.saveAutoRotate(on, pct);
      } else if (sim.snapshot) {
        sim.setAutoRotate({ ...sim.snapshot.autoRotate, enabled: on, thresholdPct: pct });
      }
    },
    [simulated, sim, actions],
  );

  // WHAT CAPTURE ACTUALLY NEEDS: `livePresent` is the backend saying "there is
  // a login here to store" (not `activeAccountId`, which some installs never
  // write — see `ClaudeAccountsSnapshot.livePresent`). The moment that login
  // is not one of the stored plans, it is stored — once.
  const liveUncaptured = snap !== null && snap.livePresent && !snap.liveCaptured;
  useAutoCapture({ active: live && liveUncaptured, liveEmail: snap?.liveEmail ?? null, capture: actions.capture });

  // The joined model — every row the strip paints comes out of it.
  const cli = useCliUsage(enabled, simulated);
  const model = useResourceModel({
    accounts: snap,
    single: simulated ? null : single.snapshot,
    cli: cli.snapshot,
    fetchedAt: multi ? accounts.fetchedAt : (single.fetchedAt ?? accounts.fetchedAt),
    claudeFailed: !simulated && !single.snapshot && (single.ipcFailed || accounts.ipcFailed),
    now,
  });

  // Header right: refresh + stamp ------------------------------------------
  const refresh = useCallback(async () => {
    await Promise.all([accounts.refresh(), multi ? Promise.resolve() : single.refresh(), cli.refresh()]);
  }, [accounts, single, multi, cli]);

  const fetchedAt = multi ? accounts.fetchedAt : (single.fetchedAt ?? accounts.fetchedAt);
  const canRefresh = multi ? accounts.canRefresh : single.canRefresh;
  const units = useMemo(
    () => ({
      day: t.monitor.usage_unit_day,
      hour: t.monitor.usage_unit_hour,
      minute: t.monitor.usage_unit_minute,
      underMinute: t.monitor.usage_under_minute,
    }),
    [t],
  );
  const waitMs = fetchedAt === null ? 0 : Math.max(0, USAGE_CACHE_MS - (now - fetchedAt));
  const refreshHint = canRefresh
    ? t.monitor.usage_refresh
    : tx(t.monitor.usage_refresh_wait, { time: formatCountdown(waitMs, units) });

  const titleRight = (
    <>
      {fetchedAt !== null && !simulated && (
        <span className="whitespace-nowrap">
          {t.monitor.usage_as_of} <RelativeTime timestamp={fetchedAt} />
        </span>
      )}
      <Tooltip content={refreshHint}>
        <AsyncButton
          size="icon-sm"
          variant="ghost"
          disabled={simulated || !canRefresh}
          onClick={refresh}
          aria-label={refreshHint}
          data-testid="fleet-usage-refresh"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
        </AsyncButton>
      </Tooltip>
    </>
  );

  const controls = multi && snap ? <UsageStripControls snapshot={snap} onSave={onSaveRotate} /> : null;

  return (
    <StripFrame planCount={stored.length} titleRight={titleRight} controls={controls}>
      <AccountRows model={model} onSwitch={onSwitch} onRemove={onRemove} />
    </StripFrame>
  );
});

export default UsageStrip;
