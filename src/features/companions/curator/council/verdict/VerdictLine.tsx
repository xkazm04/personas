// Outcome and trust in one line: the state word, what the uncalibrated bar
// means (said once, on the whole page), and how much of the rubric was
// measured.
import { useTranslation } from '@/i18n/useTranslation';

import { StateChip } from '../bench/chips';
import type { Rubric } from '../table/rubrics';
import { usePercent } from '../table/usePercent';

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
  const { t, tx } = useTranslation();
  const w = t.council.verdict;
  const percent = usePercent();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <StateChip state={state} />
        <span className="typo-body-lg text-foreground">{trust === 'trusted' ? w.trusted : w.uncalibrated}</span>
        <i aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-muted-dark" />
        <span className="flex items-center gap-2">
          <CoverageDot
            coverage={coverage}
            floor={rubric.coverageFloor}
            label={tx(w.coverage, { percent: percent(coverage) })}
          />
          <span className="typo-body-lg text-foreground">
            {percent(coverage)} {w.measured}
          </span>
        </span>
      </div>
      {lite ? <span className="typo-body text-status-warning">{w.lite_note}</span> : null}
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
