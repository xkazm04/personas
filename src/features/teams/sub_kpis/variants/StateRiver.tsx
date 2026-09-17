// STATE RIVER — twelve weeks of every project's KPI state, rebuilt from the
// append-only measurement log (kpi-strategic-map spark, WP3). One stacked area
// per project: met / on track / off-track, counted, never normalized — the
// river's WIDTH is how many KPIs are actually being measured, so a portfolio
// that quietly stops measuring visibly narrows instead of staying green.
//
// Every panel shares one 12-week window (the sampler aligns them) AND one y
// max (StateRiver.model's sharedRiverMax), because twelve charts on one screen
// that each rescale to themselves are twelve charts that cannot be compared.
import { useMemo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { CHART_PANEL_CLASS } from '../kpiChartTheme';
import { weeklyStateSeries } from '../kpiSample';
import { useLazyTrends } from '../useKpiOverview';
import type { KpiVariantProps } from '../KPIDashboard';
import { planRiverIds, riverPoints, sharedRiverMax, type RiverPoint } from './StateRiver.model';
import { StateRiverPanel, type RiverSlotState } from './StateRiverPanel';

const WEEKS = 12;

export default function StateRiver({ overview, loading, onFocus }: KpiVariantProps) {
  const { t } = useTranslation();
  const o = t.kpis.overview;

  const plan = useMemo(() => planRiverIds(overview), [overview]);
  const { trends, status, retry } = useLazyTrends(plan.ids);

  const byProject = useMemo(() => {
    const out = new Map<string, RiverPoint[]>();
    for (const p of overview) {
      const ids = plan.byProject[p.projectId];
      if (!ids) continue;
      const kpis = p.groups.flatMap((g) => g.kpis).filter((k) => ids.includes(k.id));
      out.set(p.projectId, riverPoints(weeklyStateSeries(kpis, trends, WEEKS)));
    }
    return out;
  }, [overview, plan, trends]);

  const yMax = useMemo(() => sharedRiverMax([...byProject.values()]), [byProject]);

  if (loading && overview.length === 0) return <StateRiverGhost />;

  const notLoaded = new Set(plan.notLoaded);
  // `idle` with no ids means there is nothing to fetch — that is a settled
  // "no readings", not a pending one, so it must NOT hold the ghost forever.
  const busy = status === 'loading' || (status === 'idle' && plan.ids.length > 0);

  return (
    <section className="space-y-3" data-testid="kpi-river">
      {status === 'failed' && (
        <div className={`${CHART_PANEL_CLASS} flex items-center justify-between gap-3 flex-wrap`}>
          <p className="typo-caption text-foreground">{o.trends_failed}</p>
          <button
            type="button"
            onClick={retry}
            className="typo-caption focus-ring rounded-interactive border border-primary/15 bg-secondary/20 px-2.5 py-1 text-foreground hover:bg-secondary/40"
          >
            {o.retry}
          </button>
        </div>
      )}
      {overview.map((p) => {
        const points = byProject.get(p.projectId) ?? [];
        const slot: RiverSlotState = notLoaded.has(p.projectId)
          ? 'not-loaded'
          : busy && points.every((x) => x.measured === 0)
            ? 'loading'
            : 'ready';
        return (
          <StateRiverPanel
            key={p.projectId}
            project={p}
            points={points}
            yMax={yMax}
            weeks={WEEKS}
            slot={slot}
            onOpenProject={() => onFocus({ projectId: p.projectId, groupId: null })}
          />
        );
      })}
    </section>
  );
}

function StateRiverGhost() {
  return (
    <div className="space-y-3" data-testid="kpi-river-ghost" aria-hidden="true">
      {[0, 1].map((i) => (
        <div
          key={i}
          className={`${CHART_PANEL_CLASS} space-y-2 animate-fade-in`}
          style={{ animationDelay: `${150 + i * 35}ms` }}
        >
          <span className="block h-3 w-32 rounded bg-primary/[0.06]" />
          <span className="block h-40 rounded-card bg-primary/[0.06]" />
        </div>
      ))}
    </div>
  );
}
