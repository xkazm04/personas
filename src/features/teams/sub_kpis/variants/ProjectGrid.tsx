// PROJECT GRID — small multiples (kpi-strategic-map spark, WP2). One
// IDENTICAL card per project: a share-of-total stacked bar, a coverage
// sparkline on one shared 30-day window and 0–1 axis, and the project's groups
// worst-first as chips. Comparison is the whole point, so nothing about a card
// is scaled to its own data (registry: scale-and-axis-design).
import { useMemo } from 'react';

import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { KpiVariantProps } from '../KPIDashboard';
import { useLazyTrends } from '../useKpiOverview';
import { coverageSeries, coverageWindow, gridKpiIds } from './ProjectGrid.model';
import { ProjectGridCard } from './ProjectGridCard';

const GRID_CLASS = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3';
const GHOST_BAR = 'rounded bg-primary/[0.06]';

export default function ProjectGrid({ overview, loading, onFocus }: KpiVariantProps) {
  const { t } = useTranslation();
  const o = t.kpis.overview;
  // Bounded read: GRID_ID_CAP measured ids across ALL cards, in project order
  // (see ProjectGrid.model.ts). Cards past the cap simply carry no coverage
  // line — they are never redrawn as "zero coverage".
  const { byProject, all } = useMemo(() => gridKpiIds(overview), [overview]);
  const { trends, status, retry } = useLazyTrends(all);
  // ONE window for every card, fixed to the last 30 days.
  const window = useMemo(() => coverageWindow(Date.now()), []);
  const coverage = useMemo(() => {
    const out: Record<string, number[]> = {};
    for (const p of overview) {
      out[p.projectId] = coverageSeries(byProject[p.projectId] ?? [], trends, p.total, window);
    }
    return out;
  }, [overview, byProject, trends, window]);
  const sparkGhost = status === 'loading' && Object.keys(trends).length === 0;

  if (loading && overview.length === 0) return <ProjectGridGhost />;

  return (
    <div className="space-y-3" data-testid="kpi-grid">
      {status === 'failed' && (
        <div className="flex items-center gap-3">
          <p className="typo-caption text-foreground">{o.trends_failed}</p>
          <Button variant="ghost" size="sm" onClick={retry}>
            {o.retry}
          </Button>
        </div>
      )}
      <div className={GRID_CLASS}>
        {overview.map((project) => (
          <ProjectGridCard
            key={project.projectId}
            project={project}
            coverage={coverage[project.projectId] ?? []}
            sparkGhost={sparkGhost}
            onFocus={onFocus}
          />
        ))}
      </div>
    </div>
  );
}

/** Cold store, read in flight: three card silhouettes in the real geometry,
 *  invisible for their first ~150 ms (docs/design/overview-loading.md v2). */
function ProjectGridGhost() {
  return (
    <div className={GRID_CLASS} data-testid="kpi-grid-ghost" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="rounded-card border border-primary/15 bg-secondary/10 p-4 space-y-2.5 animate-fade-in"
          style={{ animationDelay: `${150 + i * 35}ms` }}
        >
          <span className={`block h-3.5 w-32 ${GHOST_BAR}`} />
          <span className={`block h-2.5 w-full ${GHOST_BAR}`} />
          <span className={`block h-7 w-full ${GHOST_BAR}`} />
          <span className={`block h-2.5 w-3/5 ${GHOST_BAR}`} />
        </div>
      ))}
    </div>
  );
}
