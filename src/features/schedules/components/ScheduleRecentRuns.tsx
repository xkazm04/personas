import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import type { RecentScheduleRun } from '@/lib/bindings/RecentScheduleRun';
import { listRecentScheduleRuns } from '@/api/pipeline/triggers';
import { formatRelative } from '../libs/scheduleHelpers';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useOverviewStore } from '@/stores/overviewStore';
import { silentCatch } from '@/lib/silentCatch';
import {
  STATUS_CONFIG,
  STATUS_LABELS,
  UNKNOWN_STATUS,
  type StatusConfigEntry,
} from './ScheduleRowHistoryPanel';

const REFRESH_MS = 60_000;
const COLLAPSED_LIMIT = 8;

/** "Last 24 hours" section of the Schedule timeline: executions already fired
 *  by schedule triggers, so the timeline reads past → future in one view. */
export default function ScheduleRecentRuns({ filterIds }: { filterIds: Set<string> | null }) {
  const { t, tx } = useTranslation();
  const [runs, setRuns] = useState<RecentScheduleRun[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchRuns = () => {
      listRecentScheduleRuns(24)
        .then((rows) => {
          if (!cancelled) {
            setRuns(rows);
            setLoadFailed(false);
          }
        })
        .catch((err) => {
          if (!cancelled) setLoadFailed(true);
          silentCatch('ScheduleRecentRuns:list')(err);
        });
    };
    fetchRuns();
    const interval = setInterval(fetchRuns, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const visible = (runs ?? []).filter((r) => !filterIds || filterIds.has(r.persona_id));
  const failedCount = visible.filter((r) => r.status === 'failed').length;
  const shown = expanded ? visible : visible.slice(0, COLLAPSED_LIMIT);

  return (
    <div data-testid="schedule-recent-runs">
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b text-foreground border-primary/10">
        <History className="w-3.5 h-3.5 opacity-60" />
        <span className="typo-caption uppercase tracking-wider">{t.schedules.last24h_title}</span>
        <span className="text-[10px] font-mono opacity-60">({visible.length})</span>
        {failedCount > 0 && (
          <span className="text-[10px] text-red-400">
            {tx(t.schedules.last24h_failed_count, { count: failedCount })}
          </span>
        )}
      </div>

      {loadFailed ? (
        <p className="typo-caption text-foreground py-1">{t.schedules.recent_runs_load_failed}</p>
      ) : runs === null ? (
        <p className="typo-caption text-foreground py-1">{t.schedules.recent_runs_loading}</p>
      ) : visible.length === 0 ? (
        <p className="typo-caption text-foreground py-1">{t.schedules.last24h_empty}</p>
      ) : (
        <>
          <ul className="divide-y divide-primary/5">
            {shown.map((run) => (
              <RecentRunRow key={run.execution_id} run={run} />
            ))}
          </ul>
          {visible.length > COLLAPSED_LIMIT && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-[10px] text-foreground hover:text-foreground/80 transition-colors"
            >
              {expanded
                ? t.schedules.last24h_show_less
                : tx(t.schedules.last24h_show_all, { count: visible.length })}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function RecentRunRow({ run }: { run: RecentScheduleRun }) {
  const { t, tx } = useTranslation();
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);
  const setPendingExecutionFocus = useOverviewStore((s) => s.setPendingExecutionFocus);

  const config: StatusConfigEntry = STATUS_CONFIG[run.status] ?? UNKNOWN_STATUS;
  const statusLabel = STATUS_LABELS[config.labelKey](t);
  const startedAt = run.started_at ?? run.created_at;
  const durationLabel =
    run.duration_ms != null ? tx(t.schedules.run_duration, { ms: Number(run.duration_ms) }) : null;

  return (
    <li className="py-1.5 flex items-center gap-2.5">
      <span
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${config.bg} ${config.text}`}
      >
        <config.icon className={`w-2.5 h-2.5 ${run.status === 'running' ? 'animate-spin' : ''}`} />
        {statusLabel}
      </span>
      <span className="typo-caption text-foreground font-medium truncate shrink-0 max-w-[180px]">
        {run.persona_name}
      </span>
      <span className="flex-1 min-w-0 typo-caption text-foreground truncate">
        {formatRelative(startedAt)}
        {durationLabel && <span className="ml-2 opacity-70">· {durationLabel}</span>}
        {run.status === 'failed' && run.error_message && (
          <span className="ml-2 text-red-400/80">· {run.error_message}</span>
        )}
      </span>
      {run.retry_at && (
        <span className="flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 bg-amber-500/15 text-amber-400">
          {tx(t.schedules.last24h_retry_at, { time: formatRelative(run.retry_at) })}
        </span>
      )}
      <button
        onClick={() => {
          // Same deep-link as ScheduleRowHistoryPanel: GlobalExecutionList
          // watches pendingExecutionFocus and pops the detail modal.
          setPendingExecutionFocus(run.execution_id);
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
