// THE ASSAY - "the instrument bench".
//
// The bet: AN ESTATE OF KPIs IS AN ESTATE OF INSTRUMENTS, AND THIS ONE'S REAL
// SUBJECT IS INSTRUMENTATION, NOT PERFORMANCE. Measured on this machine
// 2026-10-06: 900 of 1,044 active KPIs have never produced a number, 78 have
// one nothing can judge, and ZERO are off-track. Map, Ledger and River all
// rank by verdict or by attention, so all three are ordering over 144 rows
// and drawing the other 900 as an absence - and `rankNextMove` returns null
// for every project in the estate. None of them can say WHY.
//
// `measure_kind` can, and nothing on the dashboard reads it. One lane per
// mechanism, each lane a channel that narrows at two gates, and the loss left
// in the frame where it happened:
//
//   entered by you         0.6 % yield - 824 of 829 never read
//   measured from the code  75 % yield - the only mechanism that converts
//   fetched from a service   0 % yield - 30 declared, no binding exists
//
// That comparison is the surface's whole claim, it is a comparison of SHAPES
// rather than of colours, and no other variant in this module can draw it.
//
// Same data, same actions, same destinations: the estate's own headline, the
// same portfolio-to-project descent (`useKpiAltitude`), and a stalled place
// hands the group layer the same `KpiFocus` every other variant hands it.
import { useMemo } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import type { KpiVariantProps } from '../KPIDashboard';
import { buildEstate } from '../estate/kpiEstate';
import { EstateHeadline } from '../estate/EstateHeadline';
import { useKpiAltitude } from '../estate/useKpiAltitude';
import { UNGROUPED_KEY } from '../kpiOverviewModel';
import { assayGroupPlaces, assayPlaces, buildAssay, UNGROUPED_PLACE } from './assay/Assay.model';
import { AssayLaneRow } from './assay/AssayLane';
import { FLUME_HEIGHT } from './assay/AssayFlume';

export default function Assay({ overview, loading, onFocus }: KpiVariantProps) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const estate = useMemo(() => buildEstate(overview), [overview]);
  const altitude = useKpiAltitude(estate);
  const project = altitude.project;

  // Portfolio: the places are projects, and pressing one DESCENDS. Inside a
  // project: the places are its groups, and pressing one hands the group
  // layer the same focus the map and the books hand it.
  const assay = useMemo(
    () => buildAssay(project ? assayGroupPlaces(project) : assayPlaces(estate), estate.now),
    [project, estate],
  );

  if (loading && overview.length === 0) return <AssayGhost />;

  const press = (id: string) => {
    if (!project) {
      altitude.descend(id);
      return;
    }
    onFocus({ projectId: project.projectId, groupId: id === UNGROUPED_PLACE ? UNGROUPED_KEY : id });
  };

  return (
    <div className="space-y-5" data-testid="kpi-assay">
      <EstateHeadline estate={estate} project={project} onClimb={altitude.climb} />

      <section className="space-y-5" aria-label={t.kpis.section_how}>
        <ol className="space-y-5">
          {assay.lanes.map((lane) => (
            <AssayLaneRow key={lane.kind} lane={lane} widest={assay.widest} onPress={press} />
          ))}
        </ol>
      </section>

      {/* The bench's own line, and the only sentence on the surface: the three
          stage totals, which is also the arithmetic every lane sums to. */}
      <p className="typo-caption tabular-nums border-t border-primary/10 pt-2">
        {`${tx(o.books_balance, {
          total: assay.declared,
          measured: assay.observed,
          owed: assay.declared - assay.observed,
        })} · ${o.debt_verdict} ${assay.verdict}`}
      </p>
    </div>
  );
}

/** Cold store, read in flight: the real geometry, invisible for its first
 *  ~150 ms so a fast read never flashes (docs/design/overview-loading.md). */
function AssayGhost() {
  return (
    <div className="space-y-5" data-testid="kpi-assay-ghost" aria-hidden="true">
      <span
        className="block h-8 w-64 rounded-interactive bg-primary/[0.06] animate-fade-in"
        style={{ animationDelay: '150ms' }}
      />
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="block rounded-interactive bg-primary/[0.06] animate-fade-in"
          style={{ height: FLUME_HEIGHT + 34, animationDelay: `${185 + i * 30}ms` }}
        />
      ))}
    </div>
  );
}
