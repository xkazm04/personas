/**
 * GoalsPortfolio — cross-project mission control (Goals v2 L2 "Portfolio" tab).
 *
 * Answers "where does my attention go across 10 projects / 50-100 personas?" in
 * one glance: a grand-total header + a card per project with a canonical-status
 * segmented bar, at-risk surfacing, and avg progress. Click a project to switch
 * the active project and jump to its Board. Backed by the single-query
 * `dev_tools_portfolio_summary` rollup (no N+1).
 */
import { useEffect, useState, type ComponentType } from 'react';
import { Target, AlertTriangle, Clock, FolderKanban } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { silentCatch } from '@/lib/silentCatch';
import { portfolioSummary } from '@/api/devTools/devTools';
import type { PortfolioSummary } from '@/lib/bindings/PortfolioSummary';
import type { PortfolioProjectSummary } from '@/lib/bindings/PortfolioProjectSummary';
import { GOAL_STATUS_META } from './goalStatus';

// Segment order + colour for the status bar (canonical model is the source).
const SEGMENTS = [
  { key: 'open' as const, fill: GOAL_STATUS_META.open.map.fill },
  { key: 'inProgress' as const, fill: GOAL_STATUS_META['in-progress'].map.fill },
  { key: 'blocked' as const, fill: GOAL_STATUS_META.blocked.map.fill },
  { key: 'done' as const, fill: GOAL_STATUS_META.done.map.fill },
];

export function GoalsPortfolio() {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const setActiveProject = useSystemStore((s) => s.setActiveProject);
  const setGoalsTab = useSystemStore((s) => s.setGoalsTab);

  useEffect(() => {
    let cancelled = false;
    portfolioSummary()
      .then((s) => { if (!cancelled) setSummary(s); })
      .catch(silentCatch('GoalsPortfolio.summary'))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const openProject = (projectId: string) => {
    setActiveProject(projectId);
    setGoalsTab('board');
  };

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
    <div className="space-y-4 pb-6">
      {/* Grand-total header */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label={dl.portfolio_total_goals} value={summary.totalGoals} icon={Target} tint="text-violet-400" />
        <StatTile label={dl.portfolio_at_risk} value={summary.totalAtRisk} icon={AlertTriangle} tint={summary.totalAtRisk > 0 ? 'text-amber-400' : 'text-foreground'} />
        <StatTile label={dl.goal_status_done} value={summary.totalDone} icon={GOAL_STATUS_META.done.icon} tint="text-emerald-400" />
        <StatTile label={dl.portfolio_avg_progress} value={`${summary.avgProgress}%`} icon={Clock} tint="text-blue-400" />
      </div>

      {/* Project cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {summary.projects.map((p) => (
          <ProjectCard key={p.projectId} p={p} onOpen={() => openProject(p.projectId)} openLabel={dl.portfolio_open_board} overdueLabel={dl.portfolio_overdue_label} atRiskLabel={dl.portfolio_at_risk_label} />
        ))}
      </div>
    </div>
  );
}

function StatTile({ label, value, icon: Icon, tint }: { label: string; value: number | string; icon: ComponentType<{ className?: string }>; tint: string }) {
  return (
    <div className="rounded-card border border-primary/10 bg-card/30 p-3 flex items-center gap-3">
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
  p, onOpen, openLabel, overdueLabel, atRiskLabel,
}: {
  p: PortfolioProjectSummary;
  onOpen: () => void;
  openLabel: string;
  overdueLabel: string;
  atRiskLabel: string;
}) {
  const counts = { open: p.open, inProgress: p.inProgress, blocked: p.blocked, done: p.done };
  const total = p.total || 1; // avoid /0 for the bar
  return (
    <button
      type="button"
      onClick={onOpen}
      title={openLabel}
      className="group text-left rounded-modal border border-primary/10 bg-background/50 p-4 transition-all hover:border-primary/25 hover:bg-primary/[0.03]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="typo-card-label truncate text-foreground">{p.projectName}</h4>
          <p className="typo-caption text-foreground tabular-nums">{p.total} {/* goals */}· {p.avgProgress}%</p>
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
    </button>
  );
}
