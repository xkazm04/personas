// The plot under the pointer, in words - as a tooltip, not a panel.
//
// A plot is a square: it can carry a state and a denominator but never a name.
// This is where the name goes. It used to be a card in the rail, which held
// its own height, pushed the shortlist down and read as a second empty panel
// whenever nothing was hovered. Anchored to the plot it names, it appears only
// when there is something to say and costs the rail nothing. Inert, like every
// tooltip: the plot itself is the click target.
import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useTranslation } from '@/i18n/useTranslation';

import { kpiNextMoveOf, nextMoveText } from '../../estate/kpiNextMove';
import { ageDays } from '../../estate/kpiEstate';
import { plotStyle } from './mapPlot';
import { KT } from '../../estate/kpiType';

export function MapPlotTip({ kpi, now, groupLabel }: { kpi: DevKpi; now: number; groupLabel: string }) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const style = plotStyle(kpi, now, 'state');
  const age = ageDays(kpi, now);

  return (
    <div className="w-[18rem] space-y-1 py-0.5">
      <div className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className="mt-1 block size-2.5 shrink-0 rounded-[2px]"
          style={{
            background: style.fill ?? 'transparent',
            border: style.fill ? undefined : '1px solid var(--card-border)',
          }}
        />
        <span className={KT.name}>{kpi.name}</span>
      </div>
      <p className="typo-caption">{groupLabel}</p>
      <p className="typo-caption">
        {age == null
          ? o.map_never_read
          : tx(o.map_last_read, { days: Math.round(age), cadence: kpi.cadence ?? 'manual' })}
      </p>
      <p className="typo-caption">{nextMoveText(kpiNextMoveOf(kpi, now), t, tx)}</p>
    </div>
  );
}
