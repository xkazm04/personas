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
import { useMemo, useRef, useState } from 'react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
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
import { MapTerritory } from './map/MapTerritory';
import { MapFocusCard } from './map/MapFocusCard';

/** Tall enough that 1,044 plots are individually visible at 1280px wide; the
 *  canvas is a fixed frame, never a page that grows with the estate. */
const CANVAS_HEIGHT = 640;

export default function StrategicMap({ overview, loading, onFocus, onOpen }: KpiVariantProps) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const [lens, setLens] = useState<MapLens>('state');
  const [hovered, setHovered] = useState<string | null>(null);
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
  const hoveredKpi = useMemo(
    () => (hovered ? (estate.kpis.find((k) => k.id === hovered) ?? null) : null),
    [hovered, estate],
  );

  if (loading && overview.length === 0) return <MapGhost />;

  return (
    <div className="space-y-3" data-testid="kpi-map">
      <EstateHeadline estate={estate} project={altitude.project} onClimb={altitude.climb} />
      <MapLegend
        lens={lens}
        tally={scope.tally}
        brokenPromises={promised}
        dropped={layout.dropped}
        floored={layout.floored}
      />

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
                <span className="truncate typo-title text-foreground">{frame.label}</span>
                <span className="shrink-0 typo-caption text-foreground tabular-nums">
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
              onHoverKpi={setHovered}
              onOpenKpi={onOpen}
            />
          ))}
        </div>

        <aside className="w-full space-y-4 lg:w-[320px] lg:shrink-0">
          <MapFocusCard kpi={hoveredKpi} now={estate.now} onOpen={onOpen} />
          <AttentionRail
            picks={picks}
            title={altitude.project ? o.rail_title_project : o.rail_title_portfolio}
            onOpen={(pick) => onFocus({ projectId: pick.projectId, groupId: pick.groupId ?? 'ungrouped' })}
          />
        </aside>
      </div>
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
