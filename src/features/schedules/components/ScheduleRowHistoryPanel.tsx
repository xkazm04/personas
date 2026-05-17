import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Clock, AlertCircle, Loader2, Ban } from 'lucide-react';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { listExecutionsByTrigger } from '@/api/agents/executions';
import { formatRelative } from '../libs/scheduleHelpers';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';

// Stage 1 of the inline-history feature: fetches the last N executions for
// a trigger and renders a compact peek beneath the row. Stage 2 (future
// cycle) will add a failure-rate sparkline above this list and deep-link
// each row to the specific execution in Activity instead of the tab root.
const HISTORY_LIMIT = 5;

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
    listExecutionsByTrigger(triggerId, HISTORY_LIMIT)
      .then((rows) => { if (!cancelled) setExecutions(rows); })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'failed');
        silentCatch('ScheduleRowHistoryPanel:list')(err);
      });
    return () => { cancelled = true; };
  }, [triggerId]);

  if (error) {
    return (
      <div className="px-4 py-3 typo-caption text-foreground/70">
        {t.schedules.recent_runs_load_failed}
      </div>
    );
  }
  if (executions === null) {
    return (
      <div className="px-4 py-3 flex items-center gap-2 typo-caption text-foreground/70">
        <Loader2 className="w-3 h-3 animate-spin" />
        {t.schedules.recent_runs_loading}
      </div>
    );
  }
  if (executions.length === 0) {
    return (
      <div className="px-4 py-3 typo-caption text-foreground/60">
        {t.schedules.recent_runs_empty}
      </div>
    );
  }

  return (
    <div className="px-4 py-2">
      <ul className="divide-y divide-primary/5">
        {executions.map((ex) => (
          <RunRow key={ex.id} execution={ex} />
        ))}
      </ul>
    </div>
  );
}

function RunRow({ execution }: { execution: PersonaExecution }) {
  const { t, tx } = useTranslation();
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  const config: StatusConfigEntry = STATUS_CONFIG[execution.status] ?? UNKNOWN_STATUS;
  const statusLabel = STATUS_LABELS[config.labelKey](t);

  // Each peek entry stays dense — status pill, relative time + duration, cost.
  // The trigger row above already shows persona + cron, so we don't repeat it.
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
      <span className="flex-1 min-w-0 typo-caption text-foreground/80 truncate">
        {formatRelative(startedAt)}
        {durationLabel && (
          <span className="text-foreground/55 ml-2">· {durationLabel}</span>
        )}
        {costLabel && (
          <span className="text-foreground/55 ml-2">· {costLabel}</span>
        )}
      </span>
      <button
        onClick={() => {
          // Stage 1: jumps to Overview→Activity tab. Stage 2 will deep-link
          // to the specific execution row via an executionFocusId pendingX
          // slot on uiSlice (mirrors the dev-tools cross-tab handoff pattern).
          setSidebarSection('overview');
        }}
        className="text-[10px] text-foreground/55 hover:text-foreground/80 transition-colors shrink-0"
      >
        {t.schedules.run_view_in_activity}
      </button>
    </li>
  );
}

type StatusLabelKey =
  | 'run_status_running'
  | 'run_status_queued'
  | 'run_status_succeeded'
  | 'run_status_failed'
  | 'run_status_cancelled';

interface StatusConfigEntry {
  icon: typeof CheckCircle2;
  bg: string;
  text: string;
  labelKey: StatusLabelKey;
}

const UNKNOWN_STATUS: StatusConfigEntry = {
  icon: AlertCircle,
  bg: 'bg-primary/10',
  text: 'text-foreground',
  labelKey: 'run_status_failed',
};

const STATUS_CONFIG: Record<string, StatusConfigEntry> = {
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

const STATUS_LABELS: Record<StatusLabelKey, (t: Translations) => string> = {
  run_status_running: (t) => t.schedules.run_status_running,
  run_status_queued: (t) => t.schedules.run_status_queued,
  run_status_succeeded: (t) => t.schedules.run_status_succeeded,
  run_status_failed: (t) => t.schedules.run_status_failed,
  run_status_cancelled: (t) => t.schedules.run_status_cancelled,
};
