// The header overview: one compact band of FIGURES, not sentences.
//
// Three things in a single row of chrome that is always present, loading or
// not: the shape of the roster (one mark per feature, in move order), how much
// of the codebase a feature claims (one stacked bar, and the band's ONE large
// number), and four counted chips that are also the page's filters.
import { useRef } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useElementSize } from '@/hooks/utility/interaction/useElementSize';
import type { FeatureBoardTotals } from '@/lib/bindings/FeatureBoardTotals';

import type { FeatureMove } from '../featureRules';
import type { TFeatures } from '../featuresModel';
import { ClaimBar, StateStrip } from '../svg/BandFigures';

/** The four counted chips, which are also the page's filters. */
export type BandFilter = 'waiting' | 'trouble' | 'unclaimed' | 'untouched';

export interface BoardBandProps {
  totals: FeatureBoardTotals;
  /** One entry per feature, ALREADY ordered by whose move it is. */
  moves: FeatureMove[];
  unclaimedContexts: number;
  untouchedGroups: number;
  filter: BandFilter | null;
  onFilter: (next: BandFilter | null) => void;
  t: TFeatures;
  tx: (template: string, vars: Record<string, string | number>) => string;
}

interface ChipSpec {
  id: BandFilter;
  count: number;
  label: string;
  tone: string;
}

export function BoardBand({
  totals,
  moves,
  unclaimedContexts,
  untouchedGroups,
  filter,
  onFilter,
  t,
  tx,
}: BoardBandProps) {
  const stripRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const stripSize = useElementSize(stripRef);
  const barSize = useElementSize(barRef);

  const contexts = totals.core + totals.platform + totals.tests + totals.unclaimed;
  // The share is of the WHOLE map, which is what makes it comparable between
  // projects. A zero denominator yields null, not 0: an unscanned project has
  // no share, it does not have a share of nothing.
  const claimed = contexts > 0 ? totals.core / contexts : null;

  const chips: ChipSpec[] = [
    { id: 'waiting', count: totals.waitingOnYou, label: t.chip_waiting, tone: 'text-status-pending border-status-pending/40 bg-status-pending/10' },
    { id: 'trouble', count: totals.inTrouble, label: t.chip_trouble, tone: 'text-status-error border-status-error/40 bg-status-error/10' },
    { id: 'unclaimed', count: unclaimedContexts, label: t.chip_unclaimed, tone: 'text-foreground border-border bg-secondary/40' },
    { id: 'untouched', count: untouchedGroups, label: t.chip_untouched, tone: 'text-status-warning border-status-warning/40 bg-status-warning/10' },
  ];

  return (
    <div
      data-testid="features-band"
      className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-border px-4 py-3"
    >
      {/* The one large number of the band. */}
      <div className="flex items-baseline gap-2">
        <span className="typo-data-lg text-primary" data-testid="features-claimed-share">
          {claimed == null ? t.not_measured : <Numeric value={claimed} unit="ratio" precision={0} />}
        </span>
        <span className="typo-caption max-w-[14rem]">{t.claimed_share}</span>
      </div>

      <div ref={barRef} className="min-w-[8rem] flex-1 basis-40">
        <ClaimBar
          width={Math.max(120, barSize.width)}
          slices={[
            { role: 'core', count: totals.core },
            { role: 'platform', count: totals.platform },
            { role: 'tests', count: totals.tests },
            { role: 'unclaimed', count: totals.unclaimed },
          ]}
          label={tx(t.band_claim_label, {
            core: totals.core,
            platform: totals.platform,
            tests: totals.tests,
            unclaimed: totals.unclaimed,
          })}
        />
        <p className="mt-1 typo-caption">
          {tx(t.band_counts, {
            features: totals.features,
            majors: totals.majors,
            contexts: totals.contexts,
            groups: totals.groups,
          })}
        </p>
      </div>

      <div ref={stripRef} className="min-w-[10rem] flex-1 basis-56">
        <StateStrip width={Math.max(120, stripSize.width)} moves={moves} label={t.band_state_label} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {chips.map((chip) => {
          const active = filter === chip.id;
          return (
            <Tooltip key={chip.id} content={active ? t.chip_clear : chip.label}>
              <button
                type="button"
                data-testid={`features-chip-${chip.id}`}
                aria-pressed={active}
                onClick={() => onFilter(active ? null : chip.id)}
                className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 typo-caption focus-ring ${chip.tone} ${
                  active ? 'ring-2 ring-primary/60' : ''
                }`}
              >
                <Numeric value={chip.count} unit="count" className="typo-data" />
                <span>{chip.label}</span>
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
