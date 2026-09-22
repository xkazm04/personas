// THE RIVER - "the riverbed".
//
// Winner of the kpi-descent contest's River seat (2026-09-21) and the host's
// pick of the whole field, rebuilt here in the app's own idiom. The bet: A
// RIVER INSIDE ITS BED. The bed is every KPI DECLARED; the water is what was
// actually READ that week. A portfolio that stops measuring dries up rather
// than drawing a thinner ribbon that still looks green, and a week nobody
// measured is a tick on the axis - a gap, never a zero.
//
// What it replaced was eleven small multiples of the same shape, none of them
// answering a question. This is one mainstream over its tributaries, all on
// one twelve-week axis, every tributary carrying a sentence.
import { useMemo, useState } from 'react';

import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';

import type { KpiVariantProps } from '../KPIDashboard';
import { buildEstate } from '../estate/kpiEstate';
import { EstateHeadline } from '../estate/EstateHeadline';
import { useKpiAltitude } from '../estate/useKpiAltitude';
import { weeklyStateSeries } from '../kpiSample';
import { useLazyTrends } from '../useKpiOverview';
import { planRiverIds } from './StateRiver.model';
import { toRiverbed } from './river/riverbed';
import { RiverbedChart } from './river/RiverbedChart';
import { RiverReading } from './river/RiverReading';
import { RiverTributary } from './river/RiverTributary';
import { RiverLegend } from './river/RiverLegend';

const WEEKS = 12;
const MAIN_HEIGHT = 260;
/** A window with no water in it gets a shallower bed. The shape still has to
 *  be there - the bed IS the claim - but a surface that spends 260px on an
 *  empty canvas is the anti-pattern the contest's own panel named. */
const DRY_HEIGHT = 120;

export default function StateRiver({ overview, loading, onFocus }: KpiVariantProps) {
  const { t, tx } = useTranslation();
  const o = t.kpis.overview;
  const [cursor, setCursor] = useState<number | null>(null);

  const estate = useMemo(() => buildEstate(overview), [overview]);
  const altitude = useKpiAltitude(estate);

  // Bounded read: a river that drew every project on screen would otherwise
  // issue a bulk read over the whole estate on first paint. A project is taken
  // WHOLE or not at all, and the ones left out are labelled, never drawn empty.
  const plan = useMemo(() => planRiverIds(estate.projects), [estate]);
  const { trends, status, retry } = useLazyTrends(plan.ids);

  const scopeKpis = altitude.project ? altitude.project.kpis : estate.kpis;
  const scopeTally = altitude.project ? altitude.project.tally : estate.tally;
  const mainBed = useMemo(
    () => toRiverbed(weeklyStateSeries(scopeKpis, trends, WEEKS), scopeTally.total),
    [scopeKpis, trends, scopeTally.total],
  );

  const tributaries = useMemo(() => {
    const places = altitude.project
      ? altitude.project.groups.map((g) => ({
          id: g.key,
          label: g.label,
          tally: g.tally,
          kpis: g.kpis,
          projectId: g.projectId,
          groupId: g.groupId,
        }))
      : estate.projects.map((p) => ({
          id: p.projectId,
          label: p.label,
          tally: p.tally,
          kpis: p.kpis,
          projectId: p.projectId,
          groupId: null,
        }));
    return places.map((place) => ({
      ...place,
      bed: toRiverbed(weeklyStateSeries(place.kpis, trends, WEEKS), place.tally.total),
    }));
  }, [estate, altitude.project, trends]);

  const point = useMemo(
    () => mainBed.points.find((p) => p.week === cursor) ?? mainBed.latest,
    [mainBed, cursor],
  );

  if (loading && overview.length === 0) return <RiverGhost />;

  return (
    <div className="space-y-4" data-testid="kpi-river">
      <EstateHeadline estate={estate} project={altitude.project} onClimb={altitude.climb} />

      <p className="typo-body text-foreground">
        {mainBed.peak
          ? tx(o.river_headline, { dry: mainBed.dryWeeks, weeks: WEEKS, peak: mainBed.peak.read, declared: mainBed.declared })
          : tx(o.river_headline_dry, { weeks: WEEKS, declared: mainBed.declared })}
      </p>

      {status === 'failed' && (
        <div className="flex items-center gap-3">
          <p className="typo-caption text-foreground">{o.trends_failed}</p>
          <Button variant="ghost" size="sm" onClick={retry}>
            {o.retry}
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-4 xl:flex-row">
        <div className="min-w-0 flex-1 space-y-2">
          <RiverbedChart
            bed={mainBed}
            height={mainBed.dryWeeks === mainBed.points.length ? DRY_HEIGHT : MAIN_HEIGHT}
            cursor={cursor}
            onCursor={setCursor}
          />
          <RiverLegend bed={mainBed} weeks={WEEKS} />

          <section className="space-y-0.5" aria-label={o.river_tributaries}>
            <h3 className="typo-heading text-foreground">
              {tx(o.river_tributaries_count, { count: tributaries.length })}
            </h3>
            {tributaries.map((place, i) => (
              <RiverTributary
                key={place.id}
                rank={i + 1}
                label={place.label}
                tally={place.tally}
                bed={place.bed}
                cursor={cursor}
                onOpen={() =>
                  altitude.project
                    ? onFocus({ projectId: place.projectId, groupId: place.groupId ?? 'ungrouped' })
                    : altitude.descend(place.projectId)
                }
              />
            ))}
            {plan.notLoaded.length > 0 && (
              <p className="typo-caption text-foreground">
                {tx(o.river_not_loaded_count, { count: plan.notLoaded.length })}
              </p>
            )}
          </section>
        </div>

        <div className="w-full xl:w-[20rem] xl:shrink-0">
          <RiverReading bed={mainBed} point={point} />
        </div>
      </div>
    </div>
  );
}

/** Cold store, read in flight: the real geometry, invisible for its first
 *  ~150 ms so a fast read never flashes (docs/design/overview-loading.md). */
function RiverGhost() {
  return (
    <div className="space-y-3" data-testid="kpi-river-ghost" aria-hidden="true">
      <span className="block h-8 w-72 rounded bg-primary/[0.06] animate-fade-in" style={{ animationDelay: '150ms' }} />
      <span
        className="block rounded-card bg-primary/[0.06] animate-fade-in"
        style={{ height: MAIN_HEIGHT, animationDelay: '185ms' }}
      />
    </div>
  );
}
