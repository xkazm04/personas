import { Terminal } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useSystemStore } from '@/stores/systemStore';
import type { FleetPlanRow } from '@/api/companion';

/** Terminal states — a session outside this set is still doing work. */
const FLEET_SESSION_DONE_STATES = new Set(['exited', 'finished']);

/** Normalize a cwd for cross-platform comparison (mirrors fleetSlice's `normPath`). */
const normCwd = (p: string) => p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '');

/**
 * Post-confirm outcome for a dispatched fleet plan: the backend's result
 * message rendered as markdown, plus a live still-running count sourced from
 * the Fleet store. `dispatchedRows` may be restored from persisted chat-card
 * config after a panel close/reopen, so the count is computed fresh here
 * rather than frozen at whatever it said the moment sessions were spawned.
 */
export function AthenaFleetPlanResult({
  result,
  dispatchedRows,
}: {
  result: string;
  dispatchedRows: FleetPlanRow[];
}) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const fleetSessions = useSystemStore((s) => s.fleetSessions);
  const dispatchedCwds = new Set(dispatchedRows.map((r) => normCwd(r.cwd)));
  const runningCount = fleetSessions.filter(
    (s) => dispatchedCwds.has(normCwd(s.cwd)) && !FLEET_SESSION_DONE_STATES.has(s.state),
  ).length;

  return (
    <div
      className="rounded-card border border-emerald-500/30 bg-emerald-500/[0.06] p-3 space-y-2"
      data-testid="athena-plan-card"
    >
      <MarkdownRenderer content={result} className="typo-caption text-foreground" />
      {dispatchedRows.length > 0 && (
        <p
          className="flex items-center gap-1.5 typo-caption text-foreground"
          data-testid="athena-plan-live-status"
        >
          <Terminal className="w-3 h-3 shrink-0" />
          {tx(c.fleet_plan_still_running, {
            running: runningCount,
            total: dispatchedRows.length,
          })}
        </p>
      )}
    </div>
  );
}
