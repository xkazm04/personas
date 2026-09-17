import { CheckCircle2, Heart, Clock, DollarSign, Activity, Trophy, Wallet } from 'lucide-react';
import { useQuickStats } from '../hooks/useQuickStats';
import { useSystemStore } from '@/stores/systemStore';
import { formatCost, formatRelativeTime } from '@/lib/utils/formatters';
import { useAgentStore } from '@/stores/agentStore';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

interface QuickStatsBarProps {
  personaId: string;
  /** Governance controls (Active toggle + Share) rendered at the end of the
   *  stats row, pushed right — kept visible even when there are no stats yet. */
  trailing?: React.ReactNode;
}

export function QuickStatsBar({ personaId, trailing }: QuickStatsBarProps) {
  const { t } = useTranslation();
  const { stats, loading, isEmpty } = useQuickStats(personaId);

  // Month-to-date spend against the cap the operator set. Read from the budget
  // enforcement slice rather than recomputed from `useQuickStats` executions:
  // that hook keeps only the most recent ten runs, while `budgetSpendMap` is
  // the SAME figure the run gate enforces (UTC start-of-month, see
  // `get_all_monthly_spend`). A chip that disagreed with the gate that blocks
  // runs would be worse than no chip.
  const budget = useAgentStore((s) => s.budgetSpendMap.get(personaId));
  const setEditorTab = useSystemStore((s) => s.setEditorTab);
  const setDesignSubTab = useSystemStore((s) => s.setDesignSubTab);

  const hasCap = budget != null && budget.maxBudget != null && budget.maxBudget > 0;
  const budgetChip = hasCap ? (
    <StatChip
      icon={<Wallet className="w-3 h-3" />}
      label={t.agents.life.resp_budget_label}
      value={`${formatCost(budget.spend)} / ${formatCost(budget.maxBudget)}`}
      color={budget.status === 'exceeded' ? 'red' : budget.status === 'warning' ? 'amber' : 'violet'}
      testId="quick-stat-budget"
      onClick={() => {
        setEditorTab('design');
        setDesignSubTab('responsibilities');
      }}
    />
  ) : null;

  const trailingNode = trailing ? (
    <div className="ml-auto flex items-center gap-2">{trailing}</div>
  ) : null;

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 mt-3 flex-wrap" data-testid="quick-stats-bar">
        <div className="flex items-center gap-2 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-6 w-20 rounded-card bg-primary/5" />
          ))}
        </div>
        {trailingNode}
      </div>
    );
  }

  if (isEmpty || !stats) {
    return trailingNode || budgetChip ? (
      <div className="flex items-center gap-1.5 mt-3 flex-wrap" data-testid="quick-stats-bar">
        {budgetChip}
        {trailingNode}
      </div>
    ) : null;
  }

  return (
    <div className="flex items-center gap-1.5 mt-3 flex-wrap" data-testid="quick-stats-bar">
      <StatChip
        icon={<CheckCircle2 className="w-3 h-3" />}
        label={t.agents.editor_ui.success}
        value={`${stats.successRate}%`}
        color={stats.successRate >= 80 ? 'emerald' : stats.successRate >= 50 ? 'amber' : 'red'}
      />
      {stats.healthGrade && (
        <StatChip
          icon={<Heart className="w-3 h-3" />}
          label={t.agents.editor_ui.health}
          value={stats.healthScore != null ? String(stats.healthScore) : stats.healthGrade}
          color={stats.healthGrade === 'healthy' ? 'emerald' : stats.healthGrade === 'degraded' ? 'amber' : 'red'}
        />
      )}
      {/* Latency + cost are shown even at 0 (a genuinely instant / free run is
          real data). "No timing/cost data at all" renders a muted em-dash so a
          real $0/0ms never reads as missing. */}
      <StatChip
        icon={<Clock className="w-3 h-3" />}
        label={t.agents.editor_ui.latency}
        value={stats.hasLatencyData
          ? (stats.avgLatencyMs >= 1000 ? `${(stats.avgLatencyMs / 1000).toFixed(1)}s` : `${stats.avgLatencyMs}ms`)
          : '—'}
        color={!stats.hasLatencyData || stats.avgLatencyMs === 0 ? 'slate' : 'blue'}
      />
      <StatChip
        icon={<DollarSign className="w-3 h-3" />}
        label={t.agents.editor_ui.cost_per_run}
        value={stats.hasCostData
          ? `$${stats.avgCostPerRun < 0.01 ? stats.avgCostPerRun.toFixed(4) : stats.avgCostPerRun.toFixed(3)}`
          : '—'}
        color={!stats.hasCostData || stats.avgCostPerRun === 0 ? 'slate' : 'violet'}
      />
      {budgetChip}
      {stats.lastRunAt && (
        <StatChip
          icon={<Activity className="w-3 h-3" />}
          label={t.agents.editor_ui.last_run}
          value={formatRelativeTime(stats.lastRunAt, '—', { dateFallbackDays: 7 })}
          color={stats.lastRunStatus === 'completed' || stats.lastRunStatus === 'success' ? 'emerald' : stats.lastRunStatus === 'failed' ? 'red' : 'slate'}
        />
      )}
      <Button
        variant="accent"
        accentColor="amber"
        size="xs"
        icon={<Trophy className="w-3 h-3" />}
        onClick={() => {
          useSystemStore.getState().setSidebarSection('overview');
          // The leaderboard matrix lives on the Mission Control dashboard
          // since the 2026-08-25 monitoring consolidation.
          void import('@/stores/overviewStore').then(({ useOverviewStore }) =>
            useOverviewStore.getState().setOverviewTab('home'),
          );
        }}
        title={t.agents.editor_ui.view_in_leaderboard}
      >
        {t.agents.editor_ui.rank}
      </Button>
      {trailingNode}
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
  slate:   'text-foreground bg-secondary/20 border-primary/[0.08]',
};

function StatChip({
  icon,
  label,
  value,
  color,
  onClick,
  testId,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: ChipColor;
  /** When given, the chip becomes a control that lands on the fixing surface. */
  onClick?: () => void;
  testId?: string;
}) {
  const className = `inline-flex items-center gap-1.5 px-2 py-1 rounded-card border text-[11px] ${CHIP_COLORS[color]}`;
  const body = (
    <>
      {icon}
      <span className="font-medium">{value}</span>
    </>
  );
  if (onClick) {
    // The actionable chip uses the shared tooltip rather than a native
    // `title=` - a control the user is meant to click deserves a real tip on
    // hover AND keyboard focus (golden path: tooltip.md).
    return (
      <Tooltip content={`${label}: ${value}`}>
        <button
          type="button"
          onClick={onClick}
          data-testid={testId}
          aria-label={`${label}: ${value}`}
          className={`${className} hover:brightness-125 transition-[filter] focus-ring cursor-pointer`}
        >
          {body}
        </button>
      </Tooltip>
    );
  }
  return (
    <div className={className} data-testid={testId} title={`${label}: ${value}`}>
      {body}
    </div>
  );
}
