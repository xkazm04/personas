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
//
// VARIANT HOST (prototype round). The header carries a layout switcher; the
// choice is a per-viewer preference (`usage/usageVariant`). `classic` renders the
// tree described above, untouched — the slots, the frame, the single-login
// branch. The other four (`usage/variants/`) are lazy chunks that render ONE
// joined `ResourceModel` (`usage/useResourceModel`): the same Claude reads, plus
// the read-only Codex / Grok usage (`usage/useCliUsage`, polled only while a
// variant that shows it is up) and the fleet budgets that already ride on the
// queue snapshot in the store — no second poll. Consolidating on a winner is a
// deletion: the losing files, their names in `USAGE_VARIANTS`, and nothing here.

import { Suspense, memo, useCallback, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AsyncButton } from '@/features/shared/components/buttons';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { lazyRetry } from '@/lib/lazyRetry';
import { useSystemStore } from '@/stores/systemStore';
import type { Translations } from '@/i18n/generated/types';
import type { ClaudeRotationEvent } from '@/lib/bindings/ClaudeRotationEvent';
import { useClaudeUsage, USAGE_CACHE_MS } from './useClaudeUsage';
import { useClaudeAccounts } from './useClaudeAccounts';
import { useAutoCapture } from './useAutoCapture';
import { formatCountdown } from './usageModel';
import { AccountRows } from './AccountRows';
import { EmptySlots, GhostCard, SLOT_GRID, StripFrame } from './UsageStripShell';
import { UsageStripLive, UsageStripLoading } from './UsageStripLive';
import { UsageStripControls } from './UsageStripControls';
import { useUsageActions } from './usageStripActions';
import { useUsageClock } from './usageBits';
import { buildSimBudgets, useSimPlans } from './simulation';
import { USAGE_VARIANTS, readUsageVariant, writeUsageVariant, type UsageVariant } from './usage/usageVariant';
import { useCliUsage } from './usage/useCliUsage';
import { useResourceModel } from './usage/useResourceModel';

const LanesStrip = lazyRetry(() => import('./usage/variants/LanesStrip'));
const HorizonStrip = lazyRetry(() => import('./usage/variants/HorizonStrip'));
const CockpitStrip = lazyRetry(() => import('./usage/variants/CockpitStrip'));
const LedgerStrip = lazyRetry(() => import('./usage/variants/LedgerStrip'));

const VARIANT_VIEW = { lanes: LanesStrip, horizon: HorizonStrip, cockpit: CockpitStrip, ledger: LedgerStrip } as const;
const TABS_ID = 'fleet-usage-variant';

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
  const [variant, setVariant] = useState<UsageVariant>(readUsageVariant);
  const pickVariant = useCallback((v: UsageVariant) => {
    setVariant(v);
    writeUsageVariant(v);
  }, []);
  const classic = variant === 'classic';

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

  // The joined model — only the variants read it; classic never asks for the CLIs.
  const cli = useCliUsage(enabled && !classic, simulated);
  const liveBudgets = useSystemStore((st) => st.fleetQueue)?.budgets;
  const simBudgets = useMemo(() => (simulated ? buildSimBudgets() : null), [simulated]);
  const model = useResourceModel({
    accounts: snap,
    single: simulated ? null : single.snapshot,
    cli: classic ? null : cli.snapshot,
    budgets: simulated ? simBudgets : liveBudgets,
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

  const tabs = (
    <SegmentedTabs<UsageVariant>
      size="sm"
      fullWidth={false}
      idPrefix={TABS_ID}
      ariaLabel={t.monitor.usage_variant_aria}
      activeTab={variant}
      onTabChange={pickVariant}
      tabs={USAGE_VARIANTS.map((id) => ({ id, label: variantLabel(t, id), testId: `fleet-usage-variant-${id}` }))}
    />
  );
  const View = classic ? null : VARIANT_VIEW[variant];

  return (
    <StripFrame planCount={stored.length} titleRight={titleRight} controls={controls} tabs={tabs} bare={!classic}>
      <div
        role="tabpanel"
        id={`${TABS_ID}-panel-${variant}`}
        aria-labelledby={`${TABS_ID}-tab-${variant}`}
        className={classic ? 'contents' : 'block min-w-0'}
        data-variant={variant}
        data-mode={multi ? 'multi' : 'single'}
        data-simulated={simulated || undefined}
      >
        {View ? (
          <Suspense fallback={<div className={`${SLOT_GRID} px-3 py-1.5`}><GhostCard /><EmptySlots from={1} /></div>}>
            <View model={model} onSwitch={onSwitch} onRemove={onRemove} simulated={simulated} />
          </Suspense>
        ) : slots}
      </div>
    </StripFrame>
  );
});

function variantLabel(t: Translations, v: UsageVariant): string {
  switch (v) {
    case 'classic': return t.monitor.usage_variant_classic;
    case 'lanes': return t.monitor.usage_variant_lanes;
    case 'horizon': return t.monitor.usage_variant_horizon;
    case 'cockpit': return t.monitor.usage_variant_cockpit;
    case 'ledger': return t.monitor.usage_variant_ledger;
  }
}

export default UsageStrip;
