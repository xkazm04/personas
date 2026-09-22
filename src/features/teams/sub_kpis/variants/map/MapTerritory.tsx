// One context group on the map: its name, its denominator, and one plot per
// KPI inside it. The plots are the point - a group of 131 draws 131 of them,
// so "0 of 131 lit" is a shape before it is a sentence.
//
// The lattice carries ONE delegated handler rather than a listener per plot.
// At portfolio altitude this surface draws 1,044 plots; a tooltip each would
// be 1,044 timers and 1,044 focus targets for a layer whose job is to be read
// at a glance. The plot under the pointer is reported UP instead, and the rail
// prints its name where there is room for a name.
import type { MouseEvent } from 'react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { HATCH_BG } from '../../kpiChartTheme';
import { nextMoveOf, nextMoveText } from '../../estate/kpiNextMove';
import { fitsLabel, plotArea, plotColumns, type GroupTerritory } from './mapLayout';
import { plotStyle, type MapLens } from './mapPlot';

export function MapTerritory({
  territory,
  lens,
  now,
  dimmed,
  onOpen,
  onHoverKpi,
  onOpenKpi,
}: {
  territory: GroupTerritory;
  lens: MapLens;
  now: number;
  dimmed: boolean;
  onOpen: () => void;
  onHoverKpi: (kpiId: string | null) => void;
  onOpenKpi: (kpiId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const { rect, tally } = territory;
  const labelled = fitsLabel(rect);
  const area = plotArea(rect);
  const columns = plotColumns(tally.total, area.w, area.h);
  const rows = Math.max(1, Math.ceil(tally.total / columns));
  const plotSize = Math.min(area.w / columns, area.h / rows);
  const summary = tx(o.map_territory_aria, {
    group: territory.label,
    project: territory.projectLabel,
    measured: tally.measured,
    total: tally.total,
  });

  const kpiAt = (e: MouseEvent<HTMLElement>): string | null =>
    (e.target as HTMLElement | null)?.dataset?.kpiId ?? null;

  return (
    <div
      className="absolute transition-opacity"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, opacity: dimmed ? 0.25 : 1 }}
    >
      <Tooltip content={`${summary} — ${nextMoveText(nextMoveOf(tally), t, tx)}`} delay={250}>
        <button
          type="button"
          onClick={onOpen}
          aria-label={summary}
          data-testid={`kpi-map-territory-${territory.key}`}
          className="absolute inset-0 rounded-interactive border border-card-border bg-secondary/10 text-left hover:border-primary/50 focus-ring"
          style={territory.color ? { borderLeftColor: territory.color, borderLeftWidth: 2 } : undefined}
        />
      </Tooltip>

      {labelled && (
        <div className="pointer-events-none absolute inset-x-1.5 top-0.5 flex items-baseline justify-between gap-1">
          <span className="truncate typo-label text-foreground">{territory.label}</span>
          <span className="shrink-0 typo-code text-foreground tabular-nums">
            {`${tally.measured}/${tally.total}`}
          </span>
        </div>
      )}
      {territory.rank != null && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full typo-code tabular-nums"
          style={{ background: 'var(--primary)', color: 'var(--background)' }}
        >
          {territory.rank}
        </span>
      )}

      {/* The lattice sits ABOVE the territory button so a plot can answer the
          pointer, and hands every other event back by being transparent. */}
      <div
        aria-hidden="true"
        className="absolute grid"
        style={{
          left: area.x - rect.x,
          top: area.y - rect.y,
          width: area.w,
          height: area.h,
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridAutoRows: `${Math.max(2, plotSize - 1)}px`,
          gap: plotSize > 6 ? 1 : 0,
          alignContent: 'start',
        }}
        onMouseMove={(e) => onHoverKpi(kpiAt(e))}
        onMouseLeave={() => onHoverKpi(null)}
        onClick={(e) => {
          const id = kpiAt(e);
          if (id) onOpenKpi(id);
          else onOpen();
        }}
      >
        {territory.group.kpis.map((kpi) => {
          const style = plotStyle(kpi, now, lens);
          return (
            <span
              key={kpi.id}
              data-kpi-id={kpi.id}
              className="block rounded-[1px]"
              style={{
                background: style.fill ?? 'transparent',
                backgroundImage: style.fill ? undefined : HATCH_BG,
                backgroundSize: style.fill ? undefined : '4px 4px',
                border: style.stale
                  ? '1px dashed var(--status-info)'
                  : `1px solid ${style.fill ? 'transparent' : 'var(--card-border)'}`,
                // A broken promise is a fact ABOUT the measurement, so it is a
                // quiet dot rather than a second fill: 165 of them outshouted
                // the state hues when it was drawn as an inset ring.
                backgroundPosition: style.brokenPromise ? 'center' : undefined,
                ...(style.brokenPromise
                  ? {
                      backgroundImage: `radial-gradient(circle at center, var(--muted-foreground) 0 1px, transparent 1px), ${HATCH_BG}`,
                      backgroundSize: '100% 100%, 4px 4px',
                    }
                  : {}),
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
