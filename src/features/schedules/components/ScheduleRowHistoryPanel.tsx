import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, XCircle, Clock, AlertCircle, Loader2, Ban } from 'lucide-react';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { listExecutionsByTrigger } from '@/api/agents/executions';
import { formatRelative } from '../libs/scheduleHelpers';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { silentCatch } from '@/lib/silentCatch';

// Stage 2 of the inline-history feature. Two additions on top of Stage 1:
//
//   1. Sparkline above the run list — 14 daily buckets, success vs failure
//      proportion shown as a stacked column. Hovering a column reads out
//      the date + counts. Surfaces trend faster than reading the list.
//   2. "View in Activity →" now sets pendingExecutionFocus on the overview
//      store before navigating, so the GlobalExecutionList effect at line
//      140-150 of GlobalExecutionList.tsx pops the ExecutionDetailModal
//      onto the matching row instead of dropping the user at the tab root.
//
// Bumped the fetch window from 5 to a wider one so the sparkline has enough
// signal; the list still renders only the first LIST_LIMIT after sorting.
const FETCH_LIMIT = 50;
const LIST_LIMIT = 5;
const SPARK_DAYS = 14;

interface Props {
  triggerId: string;
}

export function ScheduleRowHistoryPanel({ triggerId }: Props) {
  const { t } = useTranslation();
  const [executions, setExecutions] = useState<PersonaExecution[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    listExecutionsByTrigger(triggerId, FETCH_LIMIT)
      .then((rows) => { if (!cancelled) setExecutions(rows); })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed');
        silentCatch('ScheduleRowHistoryPanel:list')(err);
      });
    return () => { cancelled = true; };
  }, [triggerId]);

  if (error) {
    return (
      <div className="px-4 py-3 typo-caption text-foreground">
        {t.schedules.recent_runs_load_failed}
      </div>
    );
  }
  if (executions === null) {
    return (
      <div className="px-4 py-3 flex items-center gap-2 typo-caption text-foreground">
        <Loader2 className="w-3 h-3 animate-spin" />
        {t.schedules.recent_runs_loading}
      </div>
    );
  }
  if (executions.length === 0) {
    return (
      <div className="px-4 py-3 typo-caption text-foreground">
        {t.schedules.recent_runs_empty}
      </div>
    );
  }

  const recent = executions.slice(0, LIST_LIMIT);

  return (
    <div className="px-4 py-2 space-y-2">
      <Sparkline executions={executions} />
      <ul className="divide-y divide-primary/5">
        {recent.map((ex) => (
          <RunRow key={ex.id} execution={ex} />
        ))}
      </ul>
    </div>
  );
}

// -- Sparkline --------------------------------------------------------------

function Sparkline({ executions }: { executions: PersonaExecution[] }) {
  const { t, tx } = useTranslation();

  const buckets = useMemo(() => bucketByDay(executions, SPARK_DAYS), [executions]);
  const maxCount = Math.max(1, ...buckets.map((b) => b.total));

  // Compute the headline failure rate across all 14 days so the user sees a
  // single number anchoring the trend the bars depict.
  const totals = buckets.reduce(
    (acc, b) => ({ total: acc.total + b.total, failed: acc.failed + b.failed }),
    { total: 0, failed: 0 },
  );
  const failureRate = totals.total > 0 ? (totals.failed / totals.total) * 100 : 0;

  return (
    <div className="flex items-end gap-2 px-1">
      <div
        className="flex items-end gap-[2px] h-8"
        role="img"
        aria-label={tx(t.schedules.sparkline_aria, { days: SPARK_DAYS })}
      >
        {buckets.map((b) => {
          const ratio = b.total / maxCount;
          const heightPct = Math.max(b.total > 0 ? 18 : 4, ratio * 100);
          const failedRatio = b.total > 0 ? b.failed / b.total : 0;
          return (
            <div
              key={b.dateKey}
              className="relative w-1.5 bg-primary/10 rounded-interactive overflow-hidden"
              style={{ height: `${heightPct}%` }}
              title={`${b.dateLabel}: ${b.total} run(s), ${b.failed} failed`}
            >
              {/* Success portion (bottom, emerald) */}
              <div
                className="absolute inset-x-0 bottom-0 bg-emerald-400/70"
                style={{ height: `${(1 - failedRatio) * 100}%` }}
              />
              {/* Failure portion (top, red) */}
              <div
                className="absolute inset-x-0 top-0 bg-red-400/80"
                style={{ height: `${failedRatio * 100}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex flex-col leading-none gap-0.5">
        <span className="text-[10px] uppercase tracking-wider text-foreground">
          {tx(t.schedules.sparkline_window, { days: SPARK_DAYS })}
        </span>
        <span className="typo-caption text-foreground">
          {totals.total === 0
            ? t.schedules.sparkline_no_data
            : tx(t.schedules.sparkline_failure_rate, {
                total: totals.total,
                rate: failureRate.toFixed(0),
              })}
        </span>
      </div>
    </div>
  );
}

interface DayBucket {
  dateKey: string;   // YYYY-MM-DD for keying
  dateLabel: string; // short label for tooltip
  total: number;
  failed: number;
}

function bucketByDay(executions: PersonaExecution[], days: number): DayBucket[] {
  // Build today-back-N-days descending bucket array, fill from executions.
  const buckets: DayBucket[] = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(start.getTime() - i * 24 * 3_600_000);
    buckets.push({
      dateKey: d.toISOString().slice(0, 10),
      dateLabel: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      total: 0,
      failed: 0,
    });
  }
  const indexByKey = new Map(buckets.map((b, i) => [b.dateKey, i]));

  for (const ex of executions) {
    const tsRaw = ex.started_at ?? ex.created_at;
    if (!tsRaw) continue;
    const key = new Date(tsRaw).toISOString().slice(0, 10);
    const idx = indexByKey.get(key);
    if (idx === undefined) continue;
    const bucket = buckets[idx]!;
    bucket.total += 1;
    if (ex.status === 'failed' || ex.status === 'error') {
      bucket.failed += 1;
    }
  }
  return buckets;
}

// -- Run row ---------------------------------------------------------------

function RunRow({ execution }: { execution: PersonaExecution }) {
  const { t, tx } = useTranslation();
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);
  const setPendingExecutionFocus = useOverviewStore((s) => s.setPendingExecutionFocus);

  const config: StatusConfigEntry = STATUS_CONFIG[execution.status] ?? UNKNOWN_STATUS;
  const statusLabel = STATUS_LABELS[config.labelKey](t);

  const startedAt = execution.started_at ?? execution.created_at;
  const durationLabel = execution.duration_ms != null
    ? tx(t.schedules.run_duration, { ms: execution.duration_ms })
    : null;
  const costLabel = execution.cost_usd > 0
    ? tx(t.schedules.run_cost_usd, { cost: execution.cost_usd.toFixed(4) })
    : null;

  return (
    <li className="py-1.5 flex items-center gap-2.5">
      <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${config.bg} ${config.text}`}>
        <config.icon className={`w-2.5 h-2.5 ${execution.status === 'running' ? 'animate-spin' : ''}`} />
        {statusLabel}
      </span>
      <span className="flex-1 min-w-0 typo-caption text-foreground truncate">
        {formatRelative(startedAt)}
        {durationLabel && (
          <span className="text-foreground ml-2">· {durationLabel}</span>
        )}
        {costLabel && (
          <span className="text-foreground ml-2">· {costLabel}</span>
        )}
      </span>
      <button
        onClick={() => {
          // The GlobalExecutionList useEffect at ~L140 watches
          // pendingExecutionFocus and pops the ExecutionDetailModal onto
          // the matching row — so we drop the user into the modal in one
          // click, not just the tab root.
          setPendingExecutionFocus(execution.id);
          setOverviewTab('executions');
          setSidebarSection('overview');
        }}
        className="text-[10px] text-foreground hover:text-foreground/80 transition-colors shrink-0"
      >
        {t.schedules.run_view_in_activity}
      </button>
    </li>
  );
}

// -- Status icons + labels -------------------------------------------------
// Exported for reuse by ScheduleRecentRuns (the timeline's "Last 24 hours"
// section) so both surfaces render execution statuses identically.

type StatusLabelKey =
  | 'run_status_running'
  | 'run_status_queued'
  | 'run_status_succeeded'
  | 'run_status_failed'
  | 'run_status_incomplete'
  | 'run_status_cancelled';

export interface StatusConfigEntry {
  icon: typeof CheckCircle2;
  bg: string;
  text: string;
  labelKey: StatusLabelKey;
}

export const UNKNOWN_STATUS: StatusConfigEntry = {
  icon: AlertCircle,
  bg: 'bg-primary/10',
  text: 'text-foreground',
  labelKey: 'run_status_failed',
};

export const STATUS_CONFIG: Record<string, StatusConfigEntry> = {
  // The engine persists 'completed' / 'incomplete'; older rows and other
  // surfaces use 'succeeded' / 'success'. Map all spellings so finished runs
  // never fall through to UNKNOWN_STATUS (which renders as "Failed").
  completed: {
    icon: CheckCircle2,
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-400',
    labelKey: 'run_status_succeeded',
  },
  incomplete: {
    icon: AlertCircle,
    bg: 'bg-amber-500/15',
    text: 'text-amber-400',
    labelKey: 'run_status_incomplete',
  },
  succeeded: {
    icon: CheckCircle2,
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-400',
    labelKey: 'run_status_succeeded',
  },
  success: {
    icon: CheckCircle2,
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-400',
    labelKey: 'run_status_succeeded',
  },
  failed: {
    icon: XCircle,
    bg: 'bg-red-500/15',
    text: 'text-red-400',
    labelKey: 'run_status_failed',
  },
  error: {
    icon: XCircle,
    bg: 'bg-red-500/15',
    text: 'text-red-400',
    labelKey: 'run_status_failed',
  },
  running: {
    icon: Loader2,
    bg: 'bg-blue-500/15',
    text: 'text-blue-400',
    labelKey: 'run_status_running',
  },
  queued: {
    icon: Clock,
    bg: 'bg-amber-500/15',
    text: 'text-amber-400',
    labelKey: 'run_status_queued',
  },
  cancelled: {
    icon: Ban,
    bg: 'bg-primary/10',
    text: 'text-foreground',
    labelKey: 'run_status_cancelled',
  },
  canceled: {
    icon: Ban,
    bg: 'bg-primary/10',
    text: 'text-foreground',
    labelKey: 'run_status_cancelled',
  },
  unknown: UNKNOWN_STATUS,
};

type Translations = ReturnType<typeof useTranslation>['t'];

export const STATUS_LABELS: Record<StatusLabelKey, (t: Translations) => string> = {
  run_status_running: (t) => t.schedules.run_status_running,
  run_status_queued: (t) => t.schedules.run_status_queued,
  run_status_succeeded: (t) => t.schedules.run_status_succeeded,
  run_status_failed: (t) => t.schedules.run_status_failed,
  run_status_incomplete: (t) => t.schedules.run_status_incomplete,
  run_status_cancelled: (t) => t.schedules.run_status_cancelled,
};
