// PROTOTYPE ROUND (spark council-readout, direction G). The header's compact
// score strip: the overall as a figure AND as a bar against the threshold,
// the coverage ring, and the trust sentence said exactly once.
import { CoverageRing } from '../../../table/svg/CoverageRing';
import type { Rubric } from '../../../table/rubrics';
import { usePercent } from '../../../table/usePercent';
import { ScoreBar, useScore } from './marks';

const S = {
  overall: 'Overall',
  noOverall: 'No overall',
  bar: (v: string) => `bar ${v}`,
  short: (v: string) => `${v} under the bar`,
  clears: (v: string) => `clears by ${v}`,
  coverage: (p: string) => `${p} of the rubric measured`,
  measured: 'measured',
  uncalibrated: 'Uncalibrated: the bar is advisory and the score only orders the queue.',
  trusted: 'Calibrated: the bar binds.',
};

export function ScoreStrip({
  overall,
  coverage,
  trust,
  rubric,
}: {
  overall: number | null;
  coverage: number;
  trust: string;
  rubric: Rubric;
}) {
  const score = useScore();
  const percent = usePercent();
  const gap = overall == null ? null : overall - rubric.threshold;
  return (
    <div className="flex flex-col items-end gap-2" data-testid="findings-score-strip">
      <div className="flex items-center gap-6">
        <div className="flex items-end gap-4">
          <div className="flex flex-col items-end">
            <span className="typo-label text-muted">{S.overall}</span>
            <span className="typo-hero tabular-nums text-foreground">
              {overall == null ? S.noOverall : score(overall)}
            </span>
          </div>
          <div className="flex w-56 flex-col gap-2 pb-2">
            <ScoreBar score={overall} threshold={rubric.threshold} floor={null} height="h-3.5" />
            <div className="flex items-baseline justify-between gap-3">
              <span className="typo-body text-foreground">{S.bar(score(rubric.threshold))}</span>
              {gap != null ? (
                <span className={`typo-body ${gap < 0 ? 'text-status-warning' : 'text-status-success'}`}>
                  {gap < 0 ? S.short(score(-gap)) : S.clears(score(gap))}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CoverageRing
            coverage={coverage}
            floor={rubric.coverageFloor}
            size={84}
            label={S.coverage(percent(coverage))}
            text={percent(coverage)}
          />
          <span className="typo-body text-muted">{S.measured}</span>
        </div>
      </div>
      <span className="typo-body text-muted">{trust === 'trusted' ? S.trusted : S.uncalibrated}</span>
    </div>
  );
}
