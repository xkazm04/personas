// UsageStripLive — the strip's single-login mode: one card for whatever the
// CLI is logged in as.
//
// This IS the "add a plan" flow, and it needs no button any more: sign in with
// the CLI, the strip notices the login is not one of the stored plans and
// stores it on sight (`useAutoCapture`). Once stored the strip switches to
// `AccountRows` and this branch is never seen again on that machine — it
// exists for the first read and for a machine whose capture failed.

import { ShieldOff } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { ClaudeUsageSnapshot } from '@/lib/bindings/ClaudeUsageSnapshot';
import { orderWindows } from './usageModel';
import { CardMeter } from './AccountRows';
import { EmptySlots, GhostCard, PlanCard } from './UsageStripShell';
import { reasonLabel } from './usageBits';

/** Before the first read: one ghost card and four empty slots. */
export function UsageStripLoading() {
  const { t } = useTranslation();
  return (
    <>
      <GhostCard />
      <EmptySlots from={1} />
      <span className="sr-only" role="status">{t.monitor.usage_loading}</span>
    </>
  );
}

export function UsageStripLive({
  snapshot, liveEmail, now,
}: {
  /** The single-login read, or null when the IPC failed outright. */
  snapshot: ClaudeUsageSnapshot | null;
  liveEmail: string | null;
  now: number;
}) {
  const { t } = useTranslation();
  const reason = reasonLabel(t, snapshot ? snapshot.reason : 'ipc');
  const windows = snapshot?.available ? orderWindows(snapshot.windows).slice(0, 2) : null;

  return (
    <>
      <PlanCard
        active
        data-testid="fleet-usage-live"
        header={
          <span className="min-w-0 flex-1 truncate text-foreground" data-testid="fleet-usage-live-email">
            {liveEmail ?? t.monitor.usage_accounts_active}
          </span>
        }
      >
        {windows ? (
          windows.map((w) => <CardMeter key={w.key} w={w} now={now} t={t} />)
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

export default UsageStripLive;
