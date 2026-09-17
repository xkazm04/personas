// One project's river panel: the identity header (a button into the shared
// Project › Group layer) with its measured denominator, then exactly ONE of
// four slot states — ghost while the readings are in flight, "not loaded"
// when the id cap dropped this project, "no readings in this window" when
// every one of the twelve weeks is a gap, or the chart.
//
// Empty axes are never a state here: a chart frame with nothing in it reads
// as "zero", which is a different claim from "we did not look".
import { useTranslation } from '@/i18n/useTranslation';
import { CHART_PANEL_CLASS } from '../kpiChartTheme';
import type { KpiProjectRollup } from '../kpiOverviewModel';
import { hasReadings, type RiverPoint } from './StateRiver.model';
import { RiverChartSlotGhost, StateRiverChart } from './StateRiverChart';

export type RiverSlotState = 'loading' | 'ready' | 'not-loaded';

export function StateRiverPanel({
  project,
  points,
  yMax,
  weeks,
  slot,
  onOpenProject,
}: {
  project: KpiProjectRollup;
  points: RiverPoint[];
  yMax: number;
  weeks: number;
  slot: RiverSlotState;
  onOpenProject: () => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;

  return (
    <section className={CHART_PANEL_CLASS} data-testid="kpi-river-panel">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <button
          type="button"
          onClick={onOpenProject}
          aria-label={tx(o.lane_open, { project: project.label })}
          className="typo-label focus-ring rounded-interactive px-1 -mx-1 text-foreground hover:text-primary truncate max-w-[22rem]"
        >
          {project.label}
        </button>
        {/* muted-ok: the denominator beside the name is a structural micro-label */}
        <span className="typo-caption text-muted-foreground">
          {tx(o.measured_of, { measured: project.measured, total: project.total })}
        </span>
      </div>
      <h3 className="typo-overline text-foreground mb-2">{o.river_title}</h3>

      {slot === 'loading' && <RiverChartSlotGhost />}
      {slot === 'not-loaded' && (
        <p className="typo-caption text-foreground" data-testid="kpi-river-not-loaded">
          {o.river_not_loaded}
        </p>
      )}
      {slot === 'ready' && !hasReadings(points) && (
        <p className="typo-caption text-foreground" data-testid="kpi-river-empty">
          {o.layer_no_series}
        </p>
      )}
      {slot === 'ready' && hasReadings(points) && <StateRiverChart points={points} yMax={yMax} />}

      {/* muted-ok: the encoding caption explains the chart, it is not prose to read */}
      <p className="typo-caption text-muted-foreground mt-2">{tx(o.river_weeks_caption, { weeks })}</p>
    </section>
  );
}
