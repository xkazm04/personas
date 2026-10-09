// PROTOTYPE ROUND (spark council-readout). The verdict as a designed claim:
// the overall as the largest figure on the page, drawn against the bar with
// the shortfall visible as a dashed gap, coverage beside it, and the trust
// caveat said exactly once.
import type { CouncilRunDetail } from '@/lib/bindings/CouncilRunDetail';

import type { Rubric } from '../../../table/rubrics';
import { usePercent } from '../../../table/usePercent';
import type { HardFailure } from '../../protoModel';
import { useScore } from './format';
import { fill, S } from './strings';
import { Track } from './Track';

export function VerdictClaim({
  detail,
  rubric,
  hardFailures,
}: {
  detail: CouncilRunDetail;
  rubric: Rubric;
  hardFailures: HardFailure[];
}) {
  const score = useScore();
  const percent = usePercent();
  const { overall, coverage, trustState, outcome, mode, roundNo } = detail.run;
  const bar = rubric.threshold;
  const below = overall != null && overall < bar;
  const failed = outcome === 'fail' || hardFailures.length > 0;
  return (
    <div className={`dz-claim ${failed ? 'is-fail' : ''} ${mode === 'lite' ? 'is-lite' : ''}`}>
      <div className="flex flex-col items-start gap-1">
        <span className="typo-eyebrow text-muted">{S.overall}</span>
        <span className={`dz-bigscore typo-hero ${overall == null ? 'text-muted' : below ? 'text-foreground' : 'text-status-success'}`}>
          {overall == null ? '–' : score(overall)}
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        <div className="relative pt-7">
          <span
            className="absolute top-0 -translate-x-1/2 whitespace-nowrap typo-label text-foreground"
            style={{ left: `${bar * 100}%` }}
          >
            {S.bar} {score(bar)}
          </span>
          <Track
            size="lg"
            value={overall}
            threshold={bar}
            showGap
            label={`${S.overall} ${overall == null ? S.noOverall : score(overall)}, ${S.bar} ${score(bar)}`}
          />
        </div>
        <p className="m-0 typo-body-lg text-foreground">
          {overall == null
            ? `${S.noOverall}. ${S.noOverallWhy}`
            : below
              ? fill(S.short, { gap: score(bar - overall) })
              : fill(S.clears, { gap: score(overall - bar) })}
        </p>
      </div>

      <div className="dz-claim__full grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1">
        <span className="typo-data-lg">{percent(coverage)}</span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Track size="sm" value={coverage} floor={rubric.coverageFloor} label={fill(S.measured, { percent: percent(coverage) })} />
          <span className="typo-body text-foreground">{fill(S.measuredTail, { floor: percent(rubric.coverageFloor) })}</span>
        </div>
      </div>

      {hardFailures.length > 0 ? (
        <div className="dz-claim__full rounded-card border border-status-error/40 bg-status-error/[0.07] px-4 py-3">
          <p className="m-0 mb-1 typo-heading text-status-error">{S.hardFailures}</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {hardFailures.map((h, i) => (
              <li key={`${h.code}-${i}`} className="typo-body text-foreground">
                <span className="typo-code">{h.code}</span> {h.detail}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="dz-claim__full m-0 border-t border-border pt-3 typo-body text-foreground">
        {trustState === 'trusted' ? S.trusted : S.advisory}
        {mode === 'lite' ? ` ${S.liteNote}` : ''}
        {!detail.isLatest ? ` ${fill(S.oldRound, { round: roundNo })}` : ''}
      </p>
    </div>
  );
}
