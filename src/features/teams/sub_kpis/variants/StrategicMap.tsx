// The Strategic map (WP1, kpi-strategic-map spark) — the whole KPI portfolio
// as one sheet: a lane per project (worst band first), a cell per context
// group, color = share of MEASURED KPIs off-track, fill strength = how much of
// the group is measured, hatch = nothing measured at all. Every cell prints its
// own denominator, so a green cell with 2 of 40 measured can never pass for a
// green cell with 40 of 40. The legend doubles as a highlight filter: picking a
// band dims the rest instead of hiding it, because a map that removes cells
// stops being a map. Fetches nothing — it reads the shared overview model.
import { useMemo, useState } from 'react';

import type { KpiVariantProps } from '../KPIDashboard';
import type { KpiBand } from '../kpiOverviewModel';
import { bandCensus } from './StrategicMap.model';
import { StrategicMapGhost } from './StrategicMapGhost';
import { StrategicMapLane } from './StrategicMapLane';
import { StrategicMapLegend } from './StrategicMapLegend';

export default function StrategicMap({ overview, loading, onFocus }: KpiVariantProps) {
  const [active, setActive] = useState<KpiBand | null>(null);
  const census = useMemo(() => bandCensus(overview), [overview]);

  // Data on screen is never hidden by a refetch: the ghost paints only while
  // there is nothing at all to show.
  if (loading && overview.length === 0) {
    return (
      <div data-testid="kpi-map" className="space-y-3">
        <StrategicMapGhost />
      </div>
    );
  }

  return (
    <div data-testid="kpi-map" className="space-y-3">
      <StrategicMapLegend census={census} active={active} onToggle={setActive} />
      <div className="overflow-x-auto pb-1">
        <div className="flex flex-col gap-1.5">
          {overview.map((lane) => (
            <StrategicMapLane
              key={lane.projectId}
              lane={lane}
              active={active}
              onOpenProject={() => onFocus({ projectId: lane.projectId, groupId: null })}
              onOpenGroup={(groupId) => onFocus({ projectId: lane.projectId, groupId })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
