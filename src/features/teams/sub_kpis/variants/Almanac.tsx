// THE ALMANAC - "what the estate owes, and when".
//
// The bet: A KPI ESTATE IS A SCHEDULE, AND THE ONLY HONEST AXIS IS THE NEXT
// READING. Every other surface in this module reads the past: Map lights what
// has been read, the Books rank what is owed by weight, River draws twelve
// closed weeks of flow. None of them can say WHEN - the material is there
// (`cadence` promises a rhythm, `last_measured_at` says when it was last
// kept) and the module reduces it to one boolean, `isStale`.
//
// So: one horizontal axis, today a vertical rule through every row, debt to
// the left and forecast to the right, and one band per place with all four of
// its positions on the SAME row. Measured on this machine 2026-10-06 the
// picture it draws is brutal and true: every one of the 183 KPIs that
// promised a rhythm is past due, the deepest by about three months, and the
// other 861 promised none at all - so they are pinned past the end of the
// axis, in a hatched right margin, which is exactly where a reading nobody
// scheduled belongs.
//
// Same data, same actions, same destinations: the estate's headline, the same
// portfolio-to-project descent, and a place inside a project hands up the
// same `KpiFocus`.
import { useMemo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import type { KpiVariantProps } from '../KPIDashboard';
import { buildEstate } from '../estate/kpiEstate';
import { EstateHeadline } from '../estate/EstateHeadline';
import { useKpiAltitude } from '../estate/useKpiAltitude';
import { UNGROUPED_KEY } from '../kpiOverviewModel';
import { buildAlmanac } from './almanac/Almanac.model';
import { groupPlaces, projectPlaces, UNGROUPED_PLACE } from './kpiPlaces';
import { AlmanacBandRow, BAND_HEIGHT } from './almanac/AlmanacBand';
import { AlmanacLegend, AlmanacScale } from './almanac/AlmanacScale';

export default function Almanac({ overview, loading, onFocus }: KpiVariantProps) {
  const { t } = useTranslation();
  const estate = useMemo(() => buildEstate(overview), [overview]);
  const altitude = useKpiAltitude(estate);
  const project = altitude.project;

  const almanac = useMemo(
    () => buildAlmanac(project ? groupPlaces(project) : projectPlaces(estate), estate.now),
    [project, estate],
  );

  if (loading && overview.length === 0) return <AlmanacGhost />;

  const press = (id: string) => {
    if (!project) {
      altitude.descend(id);
      return;
    }
    onFocus({ projectId: project.projectId, groupId: id === UNGROUPED_PLACE ? UNGROUPED_KEY : id });
  };

  return (
    <div className="space-y-4" data-testid="kpi-almanac">
      <EstateHeadline estate={estate} project={project} onClimb={altitude.climb} />

      <section className="space-y-1" aria-label={t.kpis.overview.books_caption}>
        <AlmanacScale almanac={almanac} />
        {/* Divided rather than banded: the horizon is already a vertical rule
            through every row, and a second per-row fill would fight it. */}
        <ol className="divide-y divide-primary/10 border-y border-primary/10">
          {almanac.rows.map((row) => (
            <AlmanacBandRow
              key={row.id}
              row={row}
              deepest={almanac.deepest}
              farthest={almanac.farthest}
              tallest={almanac.tallest}
              onPress={press}
            />
          ))}
        </ol>
        <AlmanacLegend almanac={almanac} />
      </section>
    </div>
  );
}

/** Cold store, read in flight: the real geometry, invisible for its first
 *  ~150 ms so a fast read never flashes (docs/design/overview-loading.md). */
function AlmanacGhost() {
  return (
    <div className="space-y-4" data-testid="kpi-almanac-ghost" aria-hidden="true">
      <span
        className="block h-8 w-64 rounded-interactive bg-primary/[0.06] animate-fade-in"
        style={{ animationDelay: '150ms' }}
      />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <span
          key={i}
          className="block rounded-interactive bg-primary/[0.06] animate-fade-in"
          style={{ height: BAND_HEIGHT + 8, animationDelay: `${185 + i * 24}ms` }}
        />
      ))}
    </div>
  );
}
