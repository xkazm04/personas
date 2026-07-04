// DEV MODE experiment ledger (Phase 5) — visible while the wrench toggle is
// ON: every `dev_improve` run Athena dispatched, its outcome, and your 👍/👎
// verdict, plus the aggregate scoreboard that tells whether dev mode is
// earning its keep (dispatch→commit rate, merges, rescues, thumbs ratio).
// The verdict is the experiment signal accumulated over days of use.
import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  GitCommit,
  ThumbsDown,
  ThumbsUp,
  Wrench,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useCompanionStore } from './companionStore';
import {
  companionDevOpLedger,
  companionDevOpSetVerdict,
  type DevOpLedger as DevOpLedgerData,
  type DevOpLedgerEntry,
  type DevOpVerdict,
} from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';

export function DevOpLedger() {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const [data, setData] = useState<DevOpLedgerData | null>(null);
  const [expanded, setExpanded] = useState(false);
  // A new proactive card (dev reflection / interrupt) means a dev op just
  // changed state — refetch so the ledger stays live without polling.
  const proactiveCount = useCompanionStore((s) => s.proactive.length);

  const refresh = useCallback(() => {
    companionDevOpLedger().then(setData).catch(silentCatch('companion_dev_op_ledger'));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, proactiveCount]);

  const setVerdict = (entry: DevOpLedgerEntry, next: DevOpVerdict) => {
    // Toggle off when re-tapping the active verdict.
    const value: DevOpVerdict = entry.userVerdict === next ? null : next;
    // Optimistic — reflect instantly, then reconcile from the server.
    setData((d) =>
      d
        ? {
            ...d,
            entries: d.entries.map((e) =>
              e.opId === entry.opId ? { ...e, userVerdict: value } : e,
            ),
          }
        : d,
    );
    companionDevOpSetVerdict(entry.opId, value)
      .then(refresh)
      .catch(silentCatch('companion_dev_op_set_verdict'));
  };

  const m = data?.metrics;
  const total = m?.total ?? 0;

  const statusLabel = (status: string): string =>
    status === 'dispatched'
      ? c.dev_status_dispatched
      : status === 'completed'
        ? c.dev_status_completed
        : status === 'merged'
          ? c.dev_status_merged
          : status === 'closed'
            ? c.dev_status_closed
            : status === 'interrupted'
              ? c.dev_status_interrupted
              : status;

  const statusTone = (status: string): string =>
    status === 'merged'
      ? 'bg-status-success'
      : status === 'interrupted'
        ? 'bg-status-error'
        : status === 'dispatched'
          ? 'bg-status-info animate-pulse'
          : 'bg-foreground/40';

  return (
    <div
      className="border-b border-amber-500/15 bg-amber-500/[0.03]"
      data-testid="companion-dev-ledger"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-1.5 focus-ring"
        data-testid="companion-dev-ledger-toggle"
      >
        <Tooltip content={c.dev_ledger_hint}>
          <span className="flex items-center gap-1 typo-caption text-amber-400 flex-shrink-0">
            <Wrench className="w-3 h-3" aria-hidden />
            {c.dev_ledger_label}
          </span>
        </Tooltip>
        <span className="flex-1 typo-caption text-foreground tabular-nums truncate text-left">
          {total === 0
            ? c.dev_ledger_none
            : tx(c.dev_ledger_summary, {
                total,
                landed: m?.landedCommit ?? 0,
                merged: m?.merged ?? 0,
              })}
        </span>
        {total > 0 && (
          <span className="flex items-center gap-1.5 typo-caption text-foreground tabular-nums flex-shrink-0">
            <ThumbsUp className="w-3 h-3 text-status-success" aria-hidden />
            {m?.thumbsUp ?? 0}
            <ThumbsDown className="w-3 h-3 text-status-error" aria-hidden />
            {m?.thumbsDown ?? 0}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-foreground flex-shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-foreground flex-shrink-0" aria-hidden />
        )}
      </button>

      {expanded && (
        <div className="max-h-56 overflow-y-auto px-2 pb-2 flex flex-col gap-1">
          {!data || data.entries.length === 0 ? (
            <p className="typo-caption text-foreground px-1 py-2">{c.dev_ledger_empty}</p>
          ) : (
            data.entries.map((e) => (
              <div
                key={e.opId}
                className="flex items-center gap-2 rounded-interactive bg-secondary/40 px-2 py-1"
                data-testid={`dev-ledger-row-${e.opId}`}
              >
                <Tooltip content={statusLabel(e.status)}>
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusTone(e.status)}`}
                    aria-label={statusLabel(e.status)}
                  />
                </Tooltip>
                <div className="min-w-0 flex-1">
                  <div className="typo-caption text-foreground truncate" title={e.request}>
                    {e.request}
                  </div>
                  <div className="flex items-center gap-2 typo-caption text-foreground">
                    <RelativeTime timestamp={e.createdAt} />
                    {e.commitSha && (
                      <span className="flex items-center gap-0.5 tabular-nums">
                        <GitCommit className="w-2.5 h-2.5" aria-hidden />
                        {e.commitSha}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setVerdict(e, 'up')}
                    aria-pressed={e.userVerdict === 'up'}
                    aria-label={c.dev_ledger_verdict_up}
                    title={c.dev_ledger_verdict_up}
                    data-testid={`dev-ledger-up-${e.opId}`}
                    className={`p-1 rounded-interactive transition-colors focus-ring ${
                      e.userVerdict === 'up'
                        ? 'bg-status-success/15 text-status-success'
                        : 'text-foreground/40 hover:text-status-success hover:bg-status-success/10'
                    }`}
                  >
                    <ThumbsUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setVerdict(e, 'down')}
                    aria-pressed={e.userVerdict === 'down'}
                    aria-label={c.dev_ledger_verdict_down}
                    title={c.dev_ledger_verdict_down}
                    data-testid={`dev-ledger-down-${e.opId}`}
                    className={`p-1 rounded-interactive transition-colors focus-ring ${
                      e.userVerdict === 'down'
                        ? 'bg-status-error/15 text-status-error'
                        : 'text-foreground/40 hover:text-status-error hover:bg-status-error/10'
                    }`}
                  >
                    <ThumbsDown className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
