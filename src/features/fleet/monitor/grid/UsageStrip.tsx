// UsageStrip — the band above the project columns that says how much of the
// Claude subscription this fleet has burned, whose logins those are, and —
// once logins are stored — which of up to five plans is live and how the
// others are doing.
//
// THE FRAME (`UsageStripShell`) is a header row and five plan slots. This
// file decides what goes in each:
//   • HEADER LEFT — the title and the stored-plan count (the frame's own).
//   • HEADER RIGHT — `UsageStripControls` (auto-rotate, threshold, last
//     rotation) once anything is stored, then refresh with its "as of" stamp,
//     live only once the five-minute cache has elapsed.
//   • SLOTS — `AccountRows` once anything is stored, `UsageStripLive` (one
//     card) while nothing is. Empty slots keep their width, so the first plan
//     is exactly as wide as the fifth will be.
//
// STORING IS AUTOMATIC. When the backend reports a live login that is not one
// of the stored plans, `useAutoCapture` stores it — once per login, never in
// a loop — and the strip switches to multi-plan mode on the snapshot that
// comes back. The *Store this login* button is gone; Forget stays manual.
//
// The acts live in `usageStripActions`; the meters' arithmetic in `usageModel`.
//
// SIMULATION. With `simulated`, both reads are switched off (`enabled` goes
// false, so neither poll runs, and the auto-capture is inert) and the strip
// renders `useSimPlans` — five plans covering every branch `AccountRows` can
// take, including the projected, the unreadable and the quarantined. The
// switch, the forget and the auto-rotate control stay wired; they land in
// that state instead of in the backend, so each flow can be walked with its
// real confirm dialog.

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
import { UsageStripLive, UsageStripLoading } from './UsageStripLive';
import { UsageStripControls } from './UsageStripControls';
import { useUsageActions } from './usageStripActions';
import { useUsageClock } from './usageBits';
import { useSimPlans } from './simulation';

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

  // Slots -----------------------------------------------------------------
  const cold = !single.snapshot && !single.ipcFailed && !accounts.ipcFailed;
  const slots = multi ? (
    <AccountRows accounts={stored} now={now} onSwitch={onSwitch} onRemove={onRemove} />
  ) : cold ? (
    <UsageStripLoading />
  ) : (
    <UsageStripLive snapshot={single.snapshot} liveEmail={snap?.liveEmail ?? null} now={now} />
  );

  // Header right: refresh + stamp ------------------------------------------
  const refresh = useCallback(async () => {
    await Promise.all([accounts.refresh(), multi ? Promise.resolve() : single.refresh()]);
  }, [accounts, single, multi]);

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
      <div className="contents" data-mode={multi ? 'multi' : 'single'} data-simulated={simulated || undefined}>
        {slots}
      </div>
    </StripFrame>
  );
});

export default UsageStrip;
