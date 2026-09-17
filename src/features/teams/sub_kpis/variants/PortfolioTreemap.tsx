// PORTFOLIO TREEMAP — the whole KPI estate as one area-encoded canvas
// (kpi-strategic-map spark, WP3). Area = active KPIs, so the projects that
// actually carry the measurement load are the big shapes; color = band;
// the hatched share rising from each rectangle's bottom edge is the part
// NOBODY has measured. Two zoom levels only: all projects, then one
// project's context groups — the third level is the shared Project › Group
// layer, reached by clicking a group.
//
// No measurements are fetched here: the treemap answers "where is the mass
// and where is the fog", which `current_value` alone already tells us.
import { useMemo, useRef, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { UNGROUPED_KEY, type KpiProjectRollup } from '../kpiOverviewModel';
import type { KpiVariantProps } from '../KPIDashboard';
import { squarify, type TreemapItem } from './squarify';
import { TreemapCellShape, TreemapHatchDefs } from './PortfolioTreemapCell';
import { TreemapBreadcrumb, TreemapGhost, TreemapLegend } from './PortfolioTreemapChrome';
import { TREEMAP_HEIGHT, useElementWidth } from './PortfolioTreemapSize';

/** SVG focus styling lives on the container: an <g> cannot carry `focus-ring`
 *  (that class is a box-shadow ring), so focus paints the rect's stroke. */
const SVG_CLASS =
  'block w-full outline-none [&_g:focus-visible]:outline-none [&_g:focus-visible>rect]:stroke-[var(--primary)] [&_g:focus-visible>rect]:[stroke-width:2px]';

export default function PortfolioTreemap({ overview, loading, onFocus }: KpiVariantProps) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const wrapRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(wrapRef);
  const [zoom, setZoom] = useState<string | null>(null);

  const project = useMemo(
    () => (zoom ? (overview.find((p) => p.projectId === zoom) ?? null) : null),
    [overview, zoom],
  );

  const items = useMemo<TreemapItem[]>(
    () =>
      project
        ? project.groups.map((g) => ({ key: g.groupId ?? UNGROUPED_KEY, value: g.total }))
        : overview.map((p) => ({ key: p.projectId, value: p.total })),
    [overview, project],
  );

  const cells = useMemo(
    () => squarify(items, { x: 0, y: 0, w: width, h: TREEMAP_HEIGHT }),
    [items, width],
  );

  if (loading && overview.length === 0) return <TreemapGhost />;

  const bandLabel = (band: keyof typeof o.band_labels) => o.band_labels[band];

  return (
    <section className="space-y-3" data-testid="kpi-treemap">
      {project ? (
        <TreemapBreadcrumb
          projectLabel={project.label}
          onZoomOut={() => setZoom(null)}
          onOpenProject={() => onFocus({ projectId: project.projectId, groupId: null })}
        />
      ) : (
        <TreemapLegend />
      )}

      <div ref={wrapRef} className="w-full">
        <svg
          width={width}
          height={TREEMAP_HEIGHT}
          viewBox={`0 0 ${width} ${TREEMAP_HEIGHT}`}
          role="group"
          aria-label={project ? project.label : o.treemap_area_caption}
          className={SVG_CLASS}
        >
          <TreemapHatchDefs />
          {cells.map((cell) => {
            if (project) {
              const g = project.groups.find((x) => (x.groupId ?? UNGROUPED_KEY) === cell.key);
              if (!g) return null;
              return (
                <TreemapCellShape
                  key={cell.key}
                  cell={cell}
                  label={g.label}
                  band={g.band}
                  coverage={g.coverage}
                  measured={g.measured}
                  total={g.total}
                  stripe={g.color}
                  ariaLabel={tx(o.cell_aria, {
                    group: g.label,
                    band: bandLabel(g.band),
                    measured: g.measured,
                    total: g.total,
                  })}
                  onActivate={() =>
                    onFocus({ projectId: g.projectId, groupId: g.groupId ?? UNGROUPED_KEY })
                  }
                />
              );
            }
            const p = overview.find((x) => x.projectId === cell.key) as KpiProjectRollup | undefined;
            if (!p) return null;
            return (
              <TreemapCellShape
                key={cell.key}
                cell={cell}
                label={p.label}
                band={p.band}
                coverage={p.coverage}
                measured={p.measured}
                total={p.total}
                ariaLabel={tx(o.cell_aria, {
                  group: p.label,
                  band: bandLabel(p.band),
                  measured: p.measured,
                  total: p.total,
                })}
                onActivate={() => setZoom(p.projectId)}
              />
            );
          })}
        </svg>
      </div>

      {/* muted-ok: structural caption naming the encoding, not body copy */}
      <p className="typo-caption text-muted-foreground">{o.treemap_area_caption}</p>
      {project && <TreemapLegend />}
    </section>
  );
}
