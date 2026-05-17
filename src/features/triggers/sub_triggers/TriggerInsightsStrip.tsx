import { useEffect, useMemo, useState } from 'react';
import { Activity, Archive, Clock, TrendingUp, AlertTriangle } from 'lucide-react';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import type { TriggerHistoryStats } from '../hooks/useTriggerHistory';
import { listDeadLetterEvents } from '@/api/overview/events';
import { useSystemStore } from '@/stores/systemStore';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { TriggerHealthSparkline } from './TriggerHealthSparkline';
import { useTranslation } from '@/i18n/useTranslation';

interface TriggerInsightsStripProps {
  triggerId: string;
  executions: PersonaExecution[];
  stats: TriggerHistoryStats;
  loading: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function TriggerInsightsStrip({ triggerId, executions, stats, loading }: TriggerInsightsStripProps) {
  const { t, tx } = useTranslation();
  const [dlqCount, setDlqCount] = useState<number | null>(null);

  // One-shot DLQ scan filtered client-side by source_id. The DLQ tab caps at
  // 100 events anyway; matching that here keeps the strip honest without a
  // dedicated count_dead_letters_for_trigger IPC.
  useEffect(() => {
    let cancelled = false;
    listDeadLetterEvents(100).then((events) => {
      if (cancelled) return;
      setDlqCount(events.filter((e) => e.source_id === triggerId).length);
    }).catch(() => {
      // DLQ count is best-effort — falling back to "not shown" beats noisy errors.
      if (!cancelled) setDlqCount(null);
    });
    return () => { cancelled = true; };
  }, [triggerId]);

  const lastFired = executions[0]?.started_at ?? null;

  const firesLast24h = useMemo(() => {
    const cutoff = Date.now() - DAY_MS;
    return executions.filter((e) => {
      if (!e.started_at) return false;
      const ts = new Date(e.started_at).getTime();
      return !Number.isNaN(ts) && ts >= cutoff;
    }).length;
  }, [executions]);

  // Hide entirely while loading the first batch — the empty strip would
  // shift layout once data arrives.
  if (loading && executions.length === 0) return null;
  if (executions.length === 0 && (dlqCount ?? 0) === 0) return null;

  const handleOpenDlq = () => useSystemStore.getState().setEventBusTab('dead-letter');

  return (
    <div className="flex items-center flex-wrap gap-3 px-3 py-2 rounded-card bg-secondary/20 border border-primary/8">
      {executions.length > 0 && (
        <TriggerHealthSparkline executions={executions} />
      )}

      {lastFired && (
        <div className="inline-flex items-center gap-1.5 typo-caption text-foreground">
          <Clock className="w-3 h-3 text-foreground" />
          <span>{t.triggers.insights_last_fired}</span>
          <span className="tabular-nums font-medium">{formatRelativeTime(lastFired)}</span>
        </div>
      )}

      <div className="inline-flex items-center gap-1.5 typo-caption text-foreground">
        <Activity className="w-3 h-3 text-foreground" />
        <span>{t.triggers.insights_24h_label}</span>
        <span className="tabular-nums font-medium">
          {tx(t.triggers.insights_fires_count, { count: firesLast24h })}
        </span>
      </div>

      {stats.totalRuns > 0 && (
        <div className="inline-flex items-center gap-1.5 typo-caption text-foreground">
          <TrendingUp className={`w-3 h-3 ${
            stats.successRate >= 90 ? 'text-emerald-400'
              : stats.successRate >= 70 ? 'text-amber-400'
              : 'text-red-400'
          }`} />
          <span>{t.triggers.insights_success_label}</span>
          <span className="tabular-nums font-medium">{stats.successRate}%</span>
        </div>
      )}

      {stats.recentFailures >= 3 && (
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input typo-caption bg-red-500/10 text-red-400 border border-red-500/20"
          title={t.triggers.insights_recent_failures_tooltip}
        >
          <AlertTriangle className="w-3 h-3" />
          <span>{tx(t.triggers.insights_recent_failures_label, { count: stats.recentFailures })}</span>
        </span>
      )}

      {(dlqCount ?? 0) > 0 && (
        <button
          onClick={handleOpenDlq}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-input typo-caption bg-orange-500/10 text-orange-300 border border-orange-500/20 hover:bg-orange-500/15 hover:text-orange-200 transition-colors ml-auto"
          title={t.triggers.insights_dlq_open_title}
        >
          <Archive className="w-3 h-3" />
          <span>{t.triggers.insights_dlq_label}</span>
          <span className="tabular-nums font-medium">{dlqCount}</span>
        </button>
      )}
    </div>
  );
}
