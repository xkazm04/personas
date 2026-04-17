import { useMemo, useState } from 'react';
import { BarChart3, ChevronDown, ChevronRight, Trophy, ArrowUpDown } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { SCAN_AGENTS, AGENT_CATEGORIES, type ScanAgentDef } from '../constants/scanAgents';
import { HEX_COLOR_MAP } from '../constants/ideaColors';

// ---------------------------------------------------------------------------
// Types + aggregation
// ---------------------------------------------------------------------------

interface AgentStats {
  agent: ScanAgentDef;
  total: number;
  accepted: number;
  rejected: number;
  pending: number;
  acceptRate: number | null;  // null when no accepted+rejected signal
  tasksCreated: number;
  tasksCompleted: number;
  implRate: number | null;    // null when no tasks yet
  avgImpact: number | null;
  avgEffort: number | null;
}

type SortKey = 'accept' | 'impl' | 'ideas' | 'impact' | 'effort';

/**
 * Aggregate per-agent stats from the stored ideas + tasks for the active
 * project. All aggregation is client-side — no backend calls, no new schema.
 *
 * Linking ideas -> tasks uses DevTask.source_idea_id (the only concrete link).
 * Linking ideas -> agents uses DevIdea.scan_type (a string, matched against
 * ScanAgentDef.key).
 */
function computeAgentStats(
  ideas: ReturnType<typeof useSystemStore.getState>['ideas'],
  tasks: ReturnType<typeof useSystemStore.getState>['tasks'],
): AgentStats[] {
  const ideaById = new Map(ideas.map((i) => [i.id, i]));
  const ideasByAgent = new Map<string, typeof ideas>();
  for (const idea of ideas) {
    const list = ideasByAgent.get(idea.scan_type) ?? [];
    list.push(idea);
    ideasByAgent.set(idea.scan_type, list);
  }

  const tasksByAgent = new Map<string, typeof tasks>();
  for (const task of tasks) {
    if (!task.source_idea_id) continue;
    const src = ideaById.get(task.source_idea_id);
    if (!src) continue;
    const list = tasksByAgent.get(src.scan_type) ?? [];
    list.push(task);
    tasksByAgent.set(src.scan_type, list);
  }

  return SCAN_AGENTS.map((agent) => {
    const agentIdeas = ideasByAgent.get(agent.key) ?? [];
    const accepted = agentIdeas.filter((i) => i.status === 'accepted').length;
    const rejected = agentIdeas.filter((i) => i.status === 'rejected').length;
    const pending = agentIdeas.filter((i) => i.status === 'pending').length;
    const decided = accepted + rejected;

    const agentTasks = tasksByAgent.get(agent.key) ?? [];
    const completed = agentTasks.filter((t) => t.status === 'completed').length;

    const impactSamples = agentIdeas.map((i) => i.impact).filter((v): v is number => typeof v === 'number');
    const effortSamples = agentIdeas.map((i) => i.effort).filter((v): v is number => typeof v === 'number');

    const avg = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);

    return {
      agent,
      total: agentIdeas.length,
      accepted,
      rejected,
      pending,
      acceptRate: decided === 0 ? null : accepted / decided,
      tasksCreated: agentTasks.length,
      tasksCompleted: completed,
      implRate: agentTasks.length === 0 ? null : completed / agentTasks.length,
      avgImpact: avg(impactSamples),
      avgEffort: avg(effortSamples),
    };
  }).filter((s) => s.total > 0);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatPct(value: number | null, fallback: string): string {
  if (value === null) return fallback;
  return `${Math.round(value * 100)}%`;
}

function formatAvg(value: number | null, fallback: string): string {
  if (value === null) return fallback;
  return value.toFixed(1);
}

/** Color-code an acceptance rate so the eye jumps to winners/losers. */
function acceptRateColor(rate: number | null): string {
  if (rate === null) return 'text-foreground';
  if (rate >= 0.66) return 'text-emerald-400';
  if (rate >= 0.33) return 'text-amber-400';
  return 'text-red-400';
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AgentScoreboard() {
  const { t, tx } = useTranslation();
  const dt = t.plugins.dev_tools;
  const ideas = useSystemStore((s) => s.ideas);
  const tasks = useSystemStore((s) => s.tasks);
  const fallback = dt.scoreboard_no_signal;

  const [expanded, setExpanded] = useState(false);
  const [sort, setSort] = useState<SortKey>('accept');

  const rows = useMemo(() => computeAgentStats(ideas, tasks), [ideas, tasks]);

  // Ranking: winners first. For the "accept" sort, treat null as the bottom of
  // the list so agents that only produce pending ideas don't claim the top.
  const sortedRows = useMemo(() => {
    const byNullableDesc = (a: number | null, b: number | null) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a;
    };
    const copy = [...rows];
    switch (sort) {
      case 'accept': copy.sort((a, b) => byNullableDesc(a.acceptRate, b.acceptRate) || b.total - a.total); break;
      case 'impl': copy.sort((a, b) => byNullableDesc(a.implRate, b.implRate) || b.total - a.total); break;
      case 'ideas': copy.sort((a, b) => b.total - a.total); break;
      case 'impact': copy.sort((a, b) => byNullableDesc(a.avgImpact, b.avgImpact)); break;
      case 'effort': copy.sort((a, b) => byNullableDesc(a.avgEffort, b.avgEffort)); break;
    }
    return copy;
  }, [rows, sort]);

  const topAgent = sortedRows[0];

  return (
    <div className="border border-primary/10 rounded-modal overflow-hidden">
      {/* Collapsible header */}
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-primary/5 hover:bg-primary/8 transition-colors text-left"
        aria-expanded={expanded}
      >
        <BarChart3 className="w-4 h-4 text-violet-400 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h3 className="typo-section-title">{dt.scoreboard_title}</h3>
          <p className="text-md text-foreground truncate">{dt.scoreboard_subtitle}</p>
        </div>
        {/* Crown preview — tiny hint of the leader even when collapsed */}
        {!expanded && topAgent && topAgent.acceptRate !== null && (
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] text-foreground mr-2">
            <Trophy className="w-3 h-3 text-amber-400" />
            <span>{topAgent.agent.emoji}</span>
            <span className="font-medium text-foreground">{topAgent.agent.label}</span>
            <span className={`font-mono ${acceptRateColor(topAgent.acceptRate)}`}>
              {formatPct(topAgent.acceptRate, fallback)}
            </span>
          </span>
        )}
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 text-foreground" />
          : <ChevronRight className="w-3.5 h-3.5 text-foreground" />}
      </button>

      {/* Body */}
      {expanded && (
        <div className="p-4 border-t border-primary/10 bg-background/50">
          {rows.length === 0 ? (
            <p className="text-md text-foreground text-center py-8">{dt.scoreboard_empty}</p>
          ) : (
            <ScoreboardTable
              rows={sortedRows}
              sort={sort}
              onSort={setSort}
              fallback={fallback}
              labels={{
                agent: dt.scoreboard_col_agent,
                ideas: dt.scoreboard_col_ideas,
                accept: dt.scoreboard_col_accept_rate,
                impl: dt.scoreboard_col_impl_rate,
                impact: dt.scoreboard_col_avg_impact,
                effort: dt.scoreboard_col_avg_effort,
              }}
              tips={{
                ideas: dt.scoreboard_tip_ideas,
                accept: dt.scoreboard_tip_accept_rate,
                impl: dt.scoreboard_tip_impl_rate,
                impact: dt.scoreboard_tip_avg_impact,
                effort: dt.scoreboard_tip_avg_effort,
              }}
              renderPending={(n) => tx(dt.scoreboard_n_pending, { n })}
              topPerformerLabel={dt.scoreboard_top_performer}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table subcomponent — extracted so the header stays readable.
// ---------------------------------------------------------------------------

function ScoreboardTable({
  rows,
  sort,
  onSort,
  fallback,
  labels,
  tips,
  renderPending,
  topPerformerLabel,
}: {
  rows: AgentStats[];
  sort: SortKey;
  onSort: (key: SortKey) => void;
  fallback: string;
  labels: Record<'agent' | 'ideas' | 'accept' | 'impl' | 'impact' | 'effort', string>;
  tips: Record<'ideas' | 'accept' | 'impl' | 'impact' | 'effort', string>;
  renderPending: (n: number) => string;
  topPerformerLabel: string;
}) {
  const col = (key: SortKey, label: string, tip: string, extra = '') => (
    <button
      type="button"
      onClick={() => onSort(key)}
      className={`text-left text-[10px] uppercase tracking-wider font-medium transition-colors flex items-center gap-1 ${
        sort === key ? 'text-primary' : 'text-primary hover:text-foreground'
      } ${extra}`}
      title={tip}
    >
      {label}
      <ArrowUpDown className={`w-3 h-3 ${sort === key ? 'text-foreground' : 'text-foreground'}`} />
    </button>
  );

  return (
    <div className="border border-primary/10 rounded-card overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[1.6fr_0.5fr_0.7fr_0.7fr_0.7fr_0.7fr] gap-3 px-3 py-2 bg-primary/5 border-b border-primary/10 items-center">
        <span className="text-[10px] uppercase tracking-wider font-medium text-primary">{labels.agent}</span>
        {col('ideas', labels.ideas, tips.ideas, 'justify-end')}
        {col('accept', labels.accept, tips.accept, 'justify-end')}
        {col('impl', labels.impl, tips.impl, 'justify-end')}
        {col('impact', labels.impact, tips.impact, 'justify-end')}
        {col('effort', labels.effort, tips.effort, 'justify-end')}
      </div>

      {/* Rows */}
      {rows.map((row, i) => {
        const tw = HEX_COLOR_MAP[row.agent.color] ?? { bg: 'bg-primary/10', border: 'border-primary/20', text: 'text-primary' };
        const isLeader = i === 0 && row.acceptRate !== null && row.acceptRate >= 0.5;
        return (
          <div
            key={row.agent.key}
            className="grid grid-cols-[1.6fr_0.5fr_0.7fr_0.7fr_0.7fr_0.7fr] gap-3 px-3 py-2 border-b border-primary/5 last:border-b-0 hover:bg-primary/5 transition-colors items-center"
          >
            {/* Agent cell */}
            <div className="flex items-center gap-2 min-w-0">
              <div className={`w-7 h-7 rounded-card ${tw.bg} border ${tw.border} flex items-center justify-center text-md flex-shrink-0`}>
                {row.agent.emoji}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-md text-foreground font-medium truncate">{row.agent.label}</span>
                  {isLeader && (
                    <span title={topPerformerLabel} className="flex-shrink-0">
                      <Trophy className="w-3 h-3 text-amber-400" />
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-foreground truncate block">
                  {AGENT_CATEGORIES.find((c) => c.key === row.agent.categoryGroup)?.label ?? row.agent.categoryGroup}
                </span>
              </div>
            </div>

            {/* Ideas count */}
            <span className="text-md text-foreground font-mono text-right">{row.total}</span>

            {/* Accept rate */}
            <div className="text-right">
              <span className={`text-md font-mono ${acceptRateColor(row.acceptRate)}`}>
                {formatPct(row.acceptRate, fallback)}
              </span>
              {row.pending > 0 && row.acceptRate === null && (
                <div className="text-[9px] text-foreground">{renderPending(row.pending)}</div>
              )}
            </div>

            {/* Impl rate */}
            <div className="text-right">
              <span className={`text-md font-mono ${acceptRateColor(row.implRate)}`}>
                {formatPct(row.implRate, fallback)}
              </span>
              {row.tasksCreated > 0 && (
                <div className="text-[9px] text-foreground">{row.tasksCompleted}/{row.tasksCreated}</div>
              )}
            </div>

            {/* Avg impact */}
            <span className="text-md text-foreground font-mono text-right">{formatAvg(row.avgImpact, fallback)}</span>

            {/* Avg effort */}
            <span className="text-md text-foreground font-mono text-right">{formatAvg(row.avgEffort, fallback)}</span>
          </div>
        );
      })}
    </div>
  );
}
