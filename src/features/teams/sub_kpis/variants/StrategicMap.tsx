// THE MAP - "the estate at night".
//
// Winner of the kpi-descent contest's Map seat (2026-09-21), rebuilt here in
// the app's own idiom. The bet: AREA IS WHAT YOU CLAIM, LIGHT IS WHAT YOU
// WATCH. Every active KPI is one plot of land - all 1,044 of them, nothing
// capped and nothing aggregated away - lit only if it has ever been read. The
// portfolio's real shape becomes the picture: the largest territory on screen
// is also the darkest, and no amount of green elsewhere can hide it.
//
// What it replaced was a horizontal lane per project with one flat cell per
// group, which scrolled sideways forever and had exactly one level. This one
// descends: portfolio to project inside the surface, then the group layer,
// then the KPI.
import { useCallback, useMemo, useRef, useState } from 'react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { AnchoredTooltip } from '@/features/shared/components/display/Tooltip';
import { useElementSize } from '@/hooks/utility/interaction/useElementSize';
import { useTranslation } from '@/i18n/useTranslation';

import type { KpiVariantProps } from '../KPIDashboard';
import { buildEstate } from '../estate/kpiEstate';
import { EstateHeadline } from '../estate/EstateHeadline';
import { AttentionRail } from '../estate/AttentionRail';
import { picksFor } from '../estate/kpiPicks';
import { useKpiAltitude } from '../estate/useKpiAltitude';
import { layoutMap } from './map/mapLayout';
import { brokenPromises, type MapLens } from './map/mapPlot';
import { MapLegend } from './map/MapLegend';
import { MapTerritory, type PlotHit } from './map/MapTerritory';
import { MapPlotTip } from './map/MapPlotTip';
import { KT } from '../estate/kpiType';

/** Tall enough that 1,044 plots are individually visible at 1280px wide; the
 *  canvas is a fixed frame, never a page that grows with the estate. */
const CANVAS_HEIGHT = 640;

export default function StrategicMap({ overview, loading, onFocus, onOpen }: KpiVariantProps) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const [lens, setLens] = useState<MapLens>('state');
  const [hit, setHit] = useState<PlotHit | null>(null);
  // The lattice reports on every mouse move; only a CHANGE of plot is news, so
  // the whole map does not re-render for each pixel the pointer travels.
  const onHoverKpi = useCallback(
    (next: PlotHit | null) => setHit((prev) => (prev?.kpiId === next?.kpiId ? prev : next)),
    [],
  );
  const hovered = hit?.kpiId ?? null;
  const canvasRef = useRef<HTMLDivElement>(null);
  const { width } = useElementSize(canvasRef);

  const estate = useMemo(() => buildEstate(overview), [overview]);
  const altitude = useKpiAltitude(estate);
  const picks = useMemo(() => picksFor(estate, altitude.project, { limit: 6 }), [estate, altitude.project]);
  const ranks = useMemo(() => new Map(picks.map((p) => [p.id, p.rank] as const)), [picks]);
  const layout = useMemo(
    () => layoutMap(estate, altitude.project, { x: 0, y: 0, w: Math.max(0, width), h: CANVAS_HEIGHT }, ranks),
    [estate, altitude.project, width, ranks],
  );
  const scope = altitude.project ?? estate;
  const promised = useMemo(() => brokenPromises(scope.kpis), [scope]);
  const hoveredPlot = useMemo(() => {
    if (!hovered) return null;
    for (const p of estate.projects) {
      for (const g of p.groups) {
        const kpi = g.kpis.find((k) => k.id === hovered);
        if (kpi) return { kpi, groupLabel: `${p.label} / ${g.label}` };
      }
    }
    return null;
  }, [hovered, estate]);

  if (loading && overview.length === 0) return <MapGhost />;

  return (
    <div className="space-y-3" data-testid="kpi-map">
      <EstateHeadline estate={estate} project={altitude.project} onClimb={altitude.climb} />
      {/* The lens strip and the canvas it swaps sit together, and declare each
          other: the strip is the tablist, the canvas is the tabpanel it
          controls (golden path: tab-strip.md). */}
      <SegmentedTabs<MapLens>
        tabs={[
          { id: 'state', label: o.map_lens_state, testId: 'kpi-map-lens-state' },
          { id: 'freshness', label: o.map_lens_freshness, testId: 'kpi-map-lens-freshness' },
        ]}
        activeTab={lens}
        onTabChange={setLens}
        ariaLabel={o.map_lens_aria}
        idPrefix="kpi-map-lens"
        size="sm"
        fullWidth={false}
      />

      <div className="flex flex-col gap-3 lg:flex-row">
        <div
          ref={canvasRef}
          role="tabpanel"
          id={`kpi-map-lens-panel-${lens}`}
          aria-labelledby={`kpi-map-lens-tab-${lens}`}
          className="relative w-full shrink-0 lg:flex-1"
          style={{ height: CANVAS_HEIGHT }}
          data-testid="kpi-map-canvas"
        >
          {layout.frames.map((frame) => (
            <div
              key={frame.projectId}
              className="absolute rounded-card border border-primary/15"
              style={{ left: frame.rect.x, top: frame.rect.y, width: frame.rect.w, height: frame.rect.h }}
            >
              <button
                type="button"
                onClick={() => (altitude.project ? altitude.climb() : altitude.descend(frame.projectId))}
                data-testid={`kpi-map-frame-${frame.projectId}`}
                className="flex w-full items-baseline gap-2 truncate rounded-t-card px-2 py-0.5 text-left hover:bg-secondary/30 focus-ring"
              >
                <span className={`truncate ${KT.name}`}>{frame.label}</span>
                <span className="shrink-0 typo-caption tabular-nums">
                  {tx(o.map_lit_of, { measured: frame.tally.measured, total: frame.tally.total })}
                </span>
                {frame.groupsUnknown && (
                  <span className="shrink-0 typo-caption text-status-warning">{o.groups_unknown}</span>
                )}
              </button>
            </div>
          ))}
          {layout.territories.map((territory) => (
            <MapTerritory
              key={territory.key}
              territory={territory}
              lens={lens}
              now={estate.now}
              dimmed={hovered != null && territory.group.kpis.every((k) => k.id !== hovered)}
              onOpen={() => onFocus({ projectId: territory.projectId, groupId: territory.groupId ?? 'ungrouped' })}
              onHoverKpi={onHoverKpi}
              onOpenKpi={onOpen}
            />
          ))}
        </div>

        <aside className="w-full lg:w-[300px] lg:shrink-0">
          <AttentionRail
            picks={picks}
            title={altitude.project ? o.rail_title_project : o.rail_title_portfolio}
            onOpen={(pick) => onFocus({ projectId: pick.projectId, groupId: pick.groupId ?? 'ungrouped' })}
          />
        </aside>
      </div>

      <MapLegend
        lens={lens}
        tally={scope.tally}
        brokenPromises={promised}
        dropped={layout.dropped}
        floored={layout.floored}
      />

      <AnchoredTooltip
        anchor={hit?.rect ?? null}
        content={hoveredPlot ? <MapPlotTip kpi={hoveredPlot.kpi} now={estate.now} groupLabel={hoveredPlot.groupLabel} /> : null}
      />
    </div>
  );
}

/** The only moment the map has nothing at all: cold store, read in flight.
 *  The real geometry, invisible for its first ~150 ms so a fast read never
 *  flashes (docs/design/overview-loading.md). */
function MapGhost() {
  return (
    <div className="space-y-3" data-testid="kpi-map-ghost" aria-hidden="true">
      <span className="block h-8 w-64 rounded bg-primary/[0.06] animate-fade-in" style={{ animationDelay: '150ms' }} />
      <span
        className="block rounded-card bg-primary/[0.06] animate-fade-in"
        style={{ height: CANVAS_HEIGHT, animationDelay: '185ms' }}
      />
    </div>
  );
}
