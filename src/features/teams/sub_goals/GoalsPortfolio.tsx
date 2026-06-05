/**
 * GoalsPortfolio — cross-project mission control (Goals v2 L2 "Portfolio" tab).
 *
 * Answers "where does my attention go across 10 projects / 50-100 personas?" in
 * one glance: a grand-total header + a card per project with a canonical-status
 * segmented bar, at-risk surfacing, and avg progress. Click a project to switch
 * the active project and jump to its Board. Backed by the single-query
 * `dev_tools_portfolio_summary` rollup (no N+1).
 */
import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { Target, AlertTriangle, Clock, FolderKanban, ArrowUpRight, Bell } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import { portfolioSummary, attentionQueue } from '@/api/devTools/devTools';
import type { PortfolioSummary } from '@/lib/bindings/PortfolioSummary';
import type { PortfolioProjectSummary } from '@/lib/bindings/PortfolioProjectSummary';
import type { AttentionItem } from '@/lib/bindings/AttentionItem';
import { GOAL_STATUS_META } from './goalStatus';
import { GoalAtmosphere, GOAL_PANEL, goalAccentEdgeStyle } from './goalsTheme';
import { GoalAttentionDrawer } from './GoalAttentionDrawer';

// Segment order + colour for the status bar (canonical model is the source).
const SEGMENTS = [
  { key: 'open' as const, fill: GOAL_STATUS_META.open.map.fill },
  { key: 'inProgress' as const, fill: GOAL_STATUS_META['in-progress'].map.fill },
  { key: 'blocked' as const, fill: GOAL_STATUS_META.blocked.map.fill },
  { key: 'done' as const, fill: GOAL_STATUS_META.done.map.fill },
];

// Representative status for a project's accent edge — trouble surfaces first.
function projectAccentStatus(p: PortfolioProjectSummary): string {
  if (p.overdue > 0) return 'blocked';
  if (p.atRisk > 0) return 'in-progress';
  if (p.total > 0 && p.done === p.total) return 'done';
  return 'open';
}

export function GoalsPortfolio() {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  // Cross-project attention items grouped by project — drives the per-project
  // "N need attention" button + the slide-over drawer (replaces the Attention tab).
  const [attnByProject, setAttnByProject] = useState<Map<string, AttentionItem[]>>(new Map());
  const [drawerProject, setDrawerProject] = useState<{ id: string; name: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const setActiveProject = useSystemStore((s) => s.setActiveProject);
  const setGoalsTab = useSystemStore((s) => s.setGoalsTab);

  const loadData = useCallback(() => {
    let cancelled = false;
    Promise.all([
      portfolioSummary().catch(() => null),
      attentionQueue().catch(() => null),
    ]).then(([sum, queue]) => {
      if (cancelled) return;
      if (sum) setSummary(sum);
      const grouped = new Map<string, AttentionItem[]>();
      for (const item of queue?.items ?? []) {
        const arr = grouped.get(item.projectId) ?? [];
        arr.push(item);
        grouped.set(item.projectId, arr);
      }
      setAttnByProject(grouped);
    }).catch(silentCatch('GoalsPortfolio.loadData')).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => loadData(), [loadData]);

  const openProject = (projectId: string) => {
    setActiveProject(projectId);
    setGoalsTab('board');
  };

  const drawerItems = drawerProject ? (attnByProject.get(drawerProject.id) ?? []) : [];

  if (loading) {
    return <div className="flex justify-center py-16"><LoadingSpinner size="md" /></div>;
  }

  if (!summary || summary.projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <FolderKanban className="w-10 h-10 text-foreground mb-3" />
        <h3 className="typo-section-title text-foreground">{dl.portfolio_no_projects}</h3>
        <p className="typo-body text-foreground mt-1 max-w-md">{dl.portfolio_no_projects_sub}</p>
      </div>
    );
  }

  return (
    <div className="relative space-y-4 pb-6">
      <GoalAtmosphere />

      {/* Grand-total header */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile index={0} label={dl.portfolio_total_goals} value={summary.totalGoals} icon={Target} tint="text-violet-400" />
        <StatTile index={1} label={dl.portfolio_at_risk} value={summary.totalAtRisk} icon={AlertTriangle} tint={summary.totalAtRisk > 0 ? 'text-amber-400' : 'text-foreground'} glow={summary.totalAtRisk > 0} />
        <StatTile index={2} label={dl.goal_status_done} value={summary.totalDone} icon={GOAL_STATUS_META.done.icon} tint="text-emerald-400" />
        <StatTile index={3} label={dl.portfolio_avg_progress} value={`${summary.avgProgress}%`} icon={Clock} tint="text-blue-400" />
      </div>

      {/* Project cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {summary.projects.map((p, i) => (
          <ProjectCard
            key={p.projectId}
            p={p}
            index={i}
            attentionCount={attnByProject.get(p.projectId)?.length ?? 0}
            onOpen={() => openProject(p.projectId)}
            onOpenAttention={() => setDrawerProject({ id: p.projectId, name: p.projectName })}
            openLabel={dl.portfolio_open_board}
            overdueLabel={dl.portfolio_overdue_label}
            atRiskLabel={dl.portfolio_at_risk_label}
            attentionLabel={dl.portfolio_needs_attention}
          />
        ))}
      </div>

      <GoalAttentionDrawer
        isOpen={!!drawerProject}
        onClose={() => setDrawerProject(null)}
        projectName={drawerProject?.name ?? ''}
        items={drawerItems}
        onResolved={loadData}
      />
    </div>
  );
}

function StatTile({ label, value, icon: Icon, tint, index, glow = false }: { label: string; value: number | string; icon: ComponentType<{ className?: string }>; tint: string; index: number; glow?: boolean }) {
  return (
    <div
      className={`animate-fade-slide-in rounded-card border p-3 flex items-center gap-3 bg-gradient-to-br from-card/60 to-card/20 ${glow ? 'border-amber-500/25 shadow-[0_0_24px_-8px_rgba(245,158,11,0.35)]' : 'border-primary/10'}`}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className={`w-9 h-9 rounded-interactive border border-primary/15 bg-background/40 flex items-center justify-center shrink-0 ${tint}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="min-w-0">
        <p className="typo-caption uppercase tracking-[0.16em] text-foreground truncate">{label}</p>
        <p className={`typo-data-lg tabular-nums leading-none ${tint}`}>{value}</p>
      </div>
    </div>
  );
}

function ProjectCard({
  p, onOpen, onOpenAttention, attentionCount, openLabel, overdueLabel, atRiskLabel, attentionLabel, index,
}: {
  p: PortfolioProjectSummary;
  onOpen: () => void;
  onOpenAttention: () => void;
  attentionCount: number;
  openLabel: string;
  overdueLabel: string;
  atRiskLabel: string;
  attentionLabel: string;
  index: number;
}) {
  const counts = { open: p.open, inProgress: p.inProgress, blocked: p.blocked, done: p.done };
  const total = p.total || 1; // avoid /0 for the bar
  return (
    // Clickable card (opens the project's Board). A div (not a button) so the
    // attention pill can be a real nested button without invalid button-in-button.
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      title={openLabel}
      style={{ ...goalAccentEdgeStyle(projectAccentStatus(p)), animationDelay: `${index * 40}ms` }}
      className={`group relative overflow-hidden text-left p-4 pl-5 w-full cursor-pointer animate-fade-slide-in ${GOAL_PANEL}`}
    >
      <ArrowUpRight className="absolute top-3 right-3 w-3.5 h-3.5 text-foreground opacity-0 -translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 transition-[opacity,transform] duration-200" />
      <div className="flex items-start justify-between gap-2 pr-5">
        <div className="min-w-0">
          <h4 className="typo-card-label truncate text-foreground">{p.projectName}</h4>
          <p className="typo-caption text-foreground tabular-nums">{p.total} · {p.avgProgress}%</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {p.overdue > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border text-red-400 border-red-500/25 bg-red-500/10">
              {p.overdue} {overdueLabel}
            </span>
          )}
          {p.atRisk > 0 && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border text-amber-400 border-amber-500/25 bg-amber-500/10">
              {p.atRisk} {atRiskLabel}
            </span>
          )}
        </div>
      </div>

      {/* Canonical-status segmented bar */}
      <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-primary/10">
        {SEGMENTS.map((seg) => {
          const n = counts[seg.key];
          if (n === 0) return null;
          return (
            <div
              key={seg.key}
              style={{ width: `${(n / total) * 100}%`, backgroundColor: seg.fill }}
              className="h-full first:rounded-l-full last:rounded-r-full"
            />
          );
        })}
      </div>

      {/* Needs-attention button — opens the per-project slide-over drawer. */}
      {attentionCount > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenAttention(); }}
          className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-interactive border border-amber-500/25 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors focus-ring"
        >
          <Bell className="w-3 h-3" /> {attentionCount} {attentionLabel}
        </button>
      )}
    </div>
  );
}
