import { CheckCircle2, Heart, Clock, DollarSign, Activity, Trophy } from 'lucide-react';
import { useQuickStats } from '../hooks/useQuickStats';
import { useSystemStore } from '@/stores/systemStore';
import { formatRelativeTime } from '@/lib/utils/formatters';

interface QuickStatsBarProps {
  personaId: string;
}

export function QuickStatsBar({ personaId }: QuickStatsBarProps) {
  const { stats, loading, isEmpty } = useQuickStats(personaId);

  if (loading) {
    return (
      <div className="flex items-center gap-2 mt-3 animate-pulse">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-6 w-20 rounded-lg bg-primary/5" />
        ))}
      </div>
    );
  }

  if (isEmpty || !stats) return null;

  return (
    <div className="flex items-center gap-1.5 mt-3 flex-wrap" data-testid="quick-stats-bar">
      <StatChip
        icon={<CheckCircle2 className="w-3 h-3" />}
        label="Success"
        value={`${stats.successRate}%`}
        color={stats.successRate >= 80 ? 'emerald' : stats.successRate >= 50 ? 'amber' : 'red'}
      />
      {stats.healthGrade && (
        <StatChip
          icon={<Heart className="w-3 h-3" />}
          label="Health"
          value={stats.healthScore != null ? String(stats.healthScore) : stats.healthGrade}
          color={stats.healthGrade === 'healthy' ? 'emerald' : stats.healthGrade === 'degraded' ? 'amber' : 'red'}
        />
      )}
      {stats.avgLatencyMs > 0 && (
        <StatChip
          icon={<Clock className="w-3 h-3" />}
          label="Latency"
          value={stats.avgLatencyMs >= 1000 ? `${(stats.avgLatencyMs / 1000).toFixed(1)}s` : `${stats.avgLatencyMs}ms`}
          color="blue"
        />
      )}
      {stats.avgCostPerRun > 0 && (
        <StatChip
          icon={<DollarSign className="w-3 h-3" />}
          label="Cost/run"
          value={`$${stats.avgCostPerRun < 0.01 ? stats.avgCostPerRun.toFixed(4) : stats.avgCostPerRun.toFixed(3)}`}
          color="violet"
        />
      )}
      {stats.lastRunAt && (
        <StatChip
          icon={<Activity className="w-3 h-3" />}
          label="Last run"
          value={formatRelativeTime(stats.lastRunAt, '—', { dateFallbackDays: 7 })}
          color={stats.lastRunStatus === 'completed' || stats.lastRunStatus === 'success' ? 'emerald' : stats.lastRunStatus === 'failed' ? 'red' : 'slate'}
        />
      )}
      <button
        onClick={() => {
          useSystemStore.getState().setSidebarSection('overview');
          void import('@/stores/overviewStore').then(({ useOverviewStore }) =>
            useOverviewStore.getState().setOverviewTab('leaderboard'),
          );
        }}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] text-amber-400/70 bg-amber-500/5 border-amber-500/10 hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
        title="View in Leaderboard"
      >
        <Trophy className="w-3 h-3" />
        Rank
      </button>
    </div>
  );
}

// ── Stat chip ──────────────────────────────────────────────────────────

type ChipColor = 'emerald' | 'amber' | 'red' | 'blue' | 'violet' | 'slate';

const CHIP_COLORS: Record<ChipColor, string> = {
  emerald: 'text-emerald-400/80 bg-emerald-500/8 border-emerald-500/15',
  amber:   'text-amber-400/80 bg-amber-500/8 border-amber-500/15',
  red:     'text-red-400/80 bg-red-500/8 border-red-500/15',
  blue:    'text-blue-400/80 bg-blue-500/8 border-blue-500/15',
  violet:  'text-violet-400/80 bg-violet-500/8 border-violet-500/15',
  slate:   'text-muted-foreground/60 bg-secondary/20 border-primary/[0.08]',
};

function StatChip({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: ChipColor;
}) {
  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] ${CHIP_COLORS[color]}`}
      title={`${label}: ${value}`}
    >
      {icon}
      <span className="font-medium">{value}</span>
    </div>
  );
}
