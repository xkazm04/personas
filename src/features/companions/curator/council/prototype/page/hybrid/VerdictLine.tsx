// PROTOTYPE ROUND (spark council-readout, direction H). Outcome and trust in
// one line: the state word, what the uncalibrated bar means (said once, on
// the whole page), and how much of the rubric was measured.
import { StateChip } from '../../../bench/chips';
import type { Rubric } from '../../../table/rubrics';
import { usePercent } from '../../../table/usePercent';

const S = {
  uncalibrated: 'Uncalibrated: bar advisory',
  trusted: 'Calibrated: bar binds',
  measured: 'measured',
  coverage: (p: string) => `${p} of the rubric measured`,
  lite: 'Lite round: readable, decidable once a full council runs',
};

export function VerdictLine({
  state,
  trust,
  coverage,
  rubric,
  lite,
}: {
  state: string;
  trust: string;
  coverage: number;
  rubric: Rubric;
  lite: boolean;
}) {
  const percent = usePercent();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StateChip state={state} />
        <span className="typo-body-lg text-foreground">{trust === 'trusted' ? S.trusted : S.uncalibrated}</span>
        <i aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-muted-dark" />
        <span className="flex items-center gap-2">
          <CoverageDot coverage={coverage} floor={rubric.coverageFloor} label={S.coverage(percent(coverage))} />
          <span className="typo-body-lg text-foreground">
            {percent(coverage)} {S.measured}
          </span>
        </span>
      </div>
      {lite ? <span className="typo-body text-status-warning">{S.lite}</span> : null}
    </div>
  );
}

/** Coverage as a small pie: the share of the rubric's weight measured, against its floor. */
function CoverageDot({ coverage, floor, label }: { coverage: number; floor: number; label: string }) {
  const r = 9;
  const c = 2 * Math.PI * r;
  const ok = coverage >= floor;
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" role="img" aria-label={label}>
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke="color-mix(in srgb, var(--foreground) 14%, transparent)"
        strokeWidth="4"
      />
      <circle
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke={ok ? 'var(--primary)' : 'var(--status-warning)'}
        strokeWidth="4"
        strokeDasharray={`${(c * Math.max(0, Math.min(1, coverage))).toFixed(2)} ${c.toFixed(2)}`}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}
