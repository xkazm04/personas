// The rating, drawn: the rose, the overall against its bar, the coverage ring
// and the rounds. Every figure is the Council page's own - one rose in the app,
// not two.
import { useMemo } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { CoverageRing } from '@/features/teams/sub_council/table/svg/CoverageRing';
import { RoundHistory, type RoundPoint } from '@/features/teams/sub_council/table/svg/RoundHistory';
import { Rose } from '@/features/teams/sub_council/table/svg/Rose';
import type { Seat, SeatState } from '@/features/teams/sub_council/table/runModel';
import type { BoardFeature } from '@/lib/bindings/BoardFeature';
import { formatNumeric } from '@/lib/utils/formatters';

import { FEATURE_COVERAGE_FLOOR, FEATURE_THRESHOLD } from '../featureRules';
import type { TFeatures } from '../featuresModel';
import { ScoreBar } from '../svg/RowFigures';

export interface RatingPanelProps {
  feature: BoardFeature;
  t: TFeatures;
  tx: (template: string, vars: Record<string, string | number>) => string;
  language: string;
}

/** `BoardVerdict` -> the rose's `Seat`. The board carries no findings, evidence
 *  or techniques, so those are empty here rather than invented: the rose draws
 *  weight, reach, floor and measurement, which is exactly what the board knows. */
function toSeat(v: BoardFeature['verdicts'][number]): Seat {
  const state: SeatState =
    v.state === 'measured' ? 'measured'
      : v.state === 'carried' ? 'carried'
        : v.state === 'not_applicable' ? 'not_applicable'
          : 'unmeasured';
  return {
    name: v.dimension,
    weight: v.weight,
    floor: v.floor,
    kind: v.kind,
    threshold: FEATURE_THRESHOLD,
    state,
    score: v.state === 'measured' ? v.score : null,
    confidence: null,
    floorHit: v.floorHit,
    advisory: v.advisory,
    findings: [],
    evidence: [],
    techniques: [],
    delta: null,
  };
}

export function RatingPanel({ feature, t, tx, language }: RatingPanelProps) {
  const council = feature.council;
  const seats = useMemo(() => feature.verdicts.map(toSeat), [feature.verdicts]);
  const points: RoundPoint[] = feature.history.map((h) => ({
    roundNo: h.roundNo,
    overall: h.overall,
    runId: `${feature.id}-${h.roundNo}`,
  }));
  const overall = council?.overall ?? null;
  const coverage = council?.coverage ?? null;
  const thresholdText = formatNumeric(FEATURE_THRESHOLD, 'plain', { language, precision: 2 });

  return (
    <section className="rounded-card border border-border bg-secondary/30 p-4" data-testid="features-rating">
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex items-baseline gap-2">
          <span className="typo-data-lg text-foreground" data-testid="features-overall">
            {overall == null ? t.not_measured : <Numeric value={overall} precision={2} />}
          </span>
          <span className="typo-caption">{tx(t.threshold_label, { threshold: thresholdText })}</span>
        </div>

        {seats.length > 0 ? (
          <Rose
            seats={seats}
            threshold={FEATURE_THRESHOLD}
            overall={overall}
            size={172}
            label={t.rose_label}
            notMeasuredLabel={t.not_measured}
            noOverallLabel={t.no_overall}
            overallLabel={t.rose_overall}
          />
        ) : null}

        {coverage != null ? (
          <div className="flex flex-col items-center gap-1">
            <CoverageRing
              coverage={coverage}
              floor={FEATURE_COVERAGE_FLOOR}
              label={tx(t.coverage_figure_label, {
                value: formatNumeric(coverage, 'ratio', { language, precision: 0 }),
                floor: formatNumeric(FEATURE_COVERAGE_FLOOR, 'ratio', { language, precision: 0 }),
              })}
              text={formatNumeric(coverage, 'ratio', { language, precision: 0 })}
            />
            <span className="typo-caption">{t.coverage_label}</span>
          </div>
        ) : null}

        {points.length > 0 ? (
          <div className="flex flex-col items-center gap-1">
            <RoundHistory
              points={points}
              threshold={FEATURE_THRESHOLD}
              currentRound={council?.roundNo ?? points.length}
              label={t.rounds_label}
              noOverallLabel={t.no_overall}
              roundLabel={(n) => tx(t.round_label, { round: n })}
            />
            <span className="typo-caption">{t.rounds_label}</span>
          </div>
        ) : null}
      </div>

      {seats.length > 0 ? (
        <>
          <h4 className="mt-4 typo-body-lg text-foreground">{t.members_title}</h4>
          <ul className="mt-2 flex flex-col gap-1.5">
            {feature.verdicts.map((v) => {
              const score = v.state === 'measured' ? v.score : null;
              const floor = v.floor ?? FEATURE_THRESHOLD;
              const barLabel = score == null
                ? tx(t.score_bar_unmeasured, { floor: formatNumeric(floor, 'plain', { language, precision: 2 }) })
                : tx(t.score_bar_label, {
                    score: formatNumeric(score, 'plain', { language, precision: 2 }),
                    floor: formatNumeric(floor, 'plain', { language, precision: 2 }),
                  });
              return (
                <li key={v.dimension} className="flex items-center gap-3">
                  <span className="w-28 flex-none truncate typo-body text-foreground">{v.dimension}</span>
                  <ScoreBar
                    score={score}
                    floor={floor}
                    floorHit={v.floorHit}
                    advisory={v.advisory}
                    label={barLabel}
                    width={120}
                  />
                  <span className="typo-data text-foreground">
                    {score == null ? t.not_measured : <Numeric value={score} precision={2} />}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </section>
  );
}
