// The in-place Project › Group layer every strategic KPI variant opens
// (kpi-strategic-map spark, WP4). It is a LAYER, not a route: the overview
// stays mounted behind it, Escape or the back button returns, and nothing here
// re-reads the KPI rows — they arrive resolved in `overview`. Only the
// measurements are fetched, lazily, for the KPIs this subject actually shows.
import { useMemo, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { useAppKeyboard, ROUTE_DECISION_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';

import { sharedWindow } from '../kpiSample';
import { useLazyTrends } from '../useKpiOverview';
import type { KpiFocus, KpiProjectRollup } from '../kpiOverviewModel';
import { KpiLayerHeader } from './KpiLayerHeader';
import { KpiLayerControls, type KpiEnv } from './KpiLayerControls';
import { KpiBulletStrip } from './KpiBulletStrip';
import { KpiSmallMultiples } from './KpiSmallMultiples';
import { buildPanelSeries, measuredIds, resolveSubject, sortBulletRows } from './KpiGroupLayer.model';

export interface KpiGroupLayerProps {
  focus: KpiFocus;
  overview: KpiProjectRollup[];
  onBack: () => void;
  onOpen: (kpiId: string) => void;
}

export default function KpiGroupLayer({ focus, overview, onBack, onOpen }: KpiGroupLayerProps) {
  const { t } = useTranslation();
  const [env, setEnv] = useState<KpiEnv>('production');

  // Escape leaves the layer — registered on the app keyboard ladder just above
  // the route so a modal stacked on the layer (the KPI detail, at the overlay
  // rung) takes the key first and one press never closes both.
  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"]')) return;
      onBack();
      return true;
    },
    { priority: ROUTE_DECISION_PRIORITY + 5 },
  );

  const subject = useMemo(() => resolveSubject(overview, focus), [overview, focus]);
  const rows = useMemo(() => sortBulletRows(subject?.kpis ?? []), [subject]);
  const ids = useMemo(() => measuredIds(rows), [rows]);

  const { trends, status, retry } = useLazyTrends(ids);
  const chartWindow = useMemo(() => sharedWindow(trends, ids, env), [trends, ids, env]);
  const series = useMemo(() => buildPanelSeries(rows, trends, chartWindow, env), [rows, trends, chartWindow, env]);

  if (!subject) {
    // The focused project or group is gone (a refetch dropped it). Say so and
    // offer the only move that still works.
    return (
      <div className="space-y-3" data-testid="kpi-group-layer">
        <p className="typo-caption">{t.kpis.overview.layer_no_series}</p>
        <button
          type="button"
          data-testid="kpi-layer-back"
          onClick={onBack}
          aria-label={t.kpis.overview.layer_back}
          className="rounded-interactive border border-primary/25 bg-secondary/30 px-2.5 py-1 typo-label text-foreground hover:bg-secondary/50 focus-ring"
        >
          {t.kpis.overview.layer_back}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="kpi-group-layer">
      <KpiLayerHeader
        projectLabel={subject.projectLabel}
        groupLabel={subject.groupLabel}
        measured={subject.measured}
        total={subject.total}
        band={subject.band}
        onBack={onBack}
      />
      <KpiLayerControls
        projectId={focus.projectId}
        env={env}
        onEnvChange={setEnv}
        onRefresh={retry}
      />
      <KpiBulletStrip rows={rows} onOpen={onOpen} />
      {ids.length > 0 && (
        <KpiSmallMultiples
          series={series}
          window={chartWindow}
          status={status}
          onRetry={retry}
          onOpen={onOpen}
        />
      )}
    </div>
  );
}
