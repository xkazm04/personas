// The header's one line under the project name: the practice ("Solo practice,
// v2 by Athena") and how fresh its measurement is ("Measured 30 min. ago on
// a1b2c3d, up to date with master" / "Measured 2 days ago, 14 commits behind
// master" in the warning tone / "Never measured"). While the first snapshot is
// in flight the line is a calm delayed bar of the same height, so the title
// above it never moves. While a Measure runs, the freshness segment says that
// instead: the tip it runs on and the time it has left (`measure/MeasuringLine`).
import { memo } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

import { useLifecycleViewModel } from '../context';
import { isMeasuring, useMeasureSession } from '../measure/measureSession';
import { MeasuringLine } from '../measure/MeasuringLine';
import { LT } from '../system/lcType';
import { fillTemplate } from './fillTemplate';
import type { Freshness } from './freshness';

function FreshnessText({ f }: { f: Freshness }) {
  const { dl } = useLifecycleViewModel();
  const time = <RelativeTime timestamp={f.kind === 'never' ? null : f.at} />;
  switch (f.kind) {
    case 'never':
      return <>{dl.lcx1_fresh_never}</>;
    case 'current':
      return <>{fillTemplate(dl.lcx1_fresh_current, { time, sha: <span className={LT.code}>{f.sha}</span>, branch: f.branch })}</>;
    case 'behind':
      return <>{fillTemplate(f.count === 1 ? dl.lcx1_fresh_behind_one : dl.lcx1_fresh_behind, { time, count: <Numeric value={f.count} />, branch: f.branch })}</>;
    case 'measured':
      return <>{fillTemplate(dl.lcx1_fresh_measured, { time, sha: <span className={LT.code}>{f.sha}</span> })}</>;
  }
}

/** Memoised (no props): it re-renders on the view model, never because the page's shell did. */
export const HeaderSubtitle = memo(function HeaderSubtitle() {
  const { practice, freshness, loading } = useLifecycleViewModel();
  const { phase } = useMeasureSession();
  if (!practice) {
    return loading
      ? <span aria-hidden className="inline-block h-[1em] w-72 max-w-full animate-fade-in rounded-interactive bg-primary/[0.06] align-middle" style={{ animationDelay: '150ms' }} />
      : null;
  }
  return (
    <span data-testid="lc-subtitle">
      <span data-testid="lc-practice">{practice}</span>
      {isMeasuring(phase) ? (
        <>
          <span aria-hidden>{' · '}</span>
          <MeasuringLine />
        </>
      ) : freshness && (
        <>
          <span aria-hidden>{' · '}</span>
          <span
            className={freshness.kind === 'behind' ? 'text-status-warning' : undefined}
            data-testid="lc-freshness"
            data-freshness={freshness.kind}
          >
            <FreshnessText f={freshness} />
          </span>
        </>
      )}
    </span>
  );
});
