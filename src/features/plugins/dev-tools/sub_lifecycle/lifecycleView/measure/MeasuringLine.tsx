// The header subtitle's freshness segment while a Measure runs: the base tip
// it runs on and how long it has left ("Measuring a1b2c3d, about 1m 40s
// left"), from the commands' medians (`measureModel.measureEta`). While the
// plan resolves it says a worktree is being prepared; while a cancel is on its
// way, that. It ticks on the shared 1 s ticker.
import { useQuantizedNow } from '@/hooks/utility/timing/relativeTimeTicker';
import { formatDuration } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../context';
import { fillTemplate } from '../frame/fillTemplate';
import { shortSha } from '../frame/freshness';
import { LT } from '../system/lcType';
import { measureEta, type MeasureEta } from './measureModel';
import { useMeasureSession } from './measureSession';

/** Under a second left reads as finishing, not "about 0s". */
const FINISHING_MS = 1_000;

export function useEtaText(): (eta: MeasureEta) => string {
  const { dl, tx } = useLifecycleViewModel();
  return (eta) => {
    if (eta.open === 0) return dl.lcx4_left_finishing;
    if (eta.unknown === eta.open) return dl.lcx4_left_none;
    if (eta.remainingMs < FINISHING_MS && eta.unknown === 0) return dl.lcx4_left_finishing;
    const time = formatDuration(eta.remainingMs);
    return eta.unknown > 0 ? tx(dl.lcx4_left_partial, { time, count: eta.unknown }) : tx(dl.lcx4_left, { time });
  };
}

export function MeasuringLine() {
  const { dl } = useLifecycleViewModel();
  const { phase, progress } = useMeasureSession();
  const now = useQuantizedNow(1000);
  const etaText = useEtaText();
  const sha = progress?.headSha ? <span className={LT.code}>{shortSha(progress.headSha)}</span> : null;
  if (phase === 'preparing' || !progress) {
    return <span className="text-primary" data-testid="lc-measuring-line" data-phase="preparing">{dl.lcx4_sub_preparing}</span>;
  }
  if (phase === 'cancelling') {
    return <span className="text-status-warning" data-testid="lc-measuring-line" data-phase="cancelling">{dl.lcx4_sub_cancelling}</span>;
  }
  const eta = <span data-testid="lc-measuring-eta">{etaText(measureEta(progress, now))}</span>;
  return (
    <span className="text-primary" data-testid="lc-measuring-line" data-phase="running">
      {sha ? fillTemplate(dl.lcx4_sub_running_on, { sha, eta }) : fillTemplate(dl.lcx4_sub_running, { eta })}
    </span>
  );
}
