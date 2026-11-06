import { Hint } from '@/features/shared/components/kit';
import type { Counts } from '../../model/types';
import { fill, LEDGER_COPY } from './copy';

/**
 * The plan in one bar: waits | proposed | decided | running, each segment as
 * wide as its count and drawn in the row treatment it stands for (solid red,
 * dashed amber, solid primary, still green hatch). One figure beside it.
 */
export function PlanMeter({ counts }: { counts: Counts }) {
  const running = Math.min(counts.running, counts.decided);
  const segs = [
    { k: 'waits', n: counts.waits },
    { k: 'proposed', n: counts.proposed },
    { k: 'decided', n: counts.decided - running },
    { k: 'running', n: running },
  ].filter((s) => s.n > 0);
  const total = counts.proposed + counts.decided;
  const hint = fill(LEDGER_COPY.meter.hint, { w: counts.waits, p: counts.proposed, d: counts.decided, r: counts.running });
  return (
    <span className="sl-meter">
      <Hint content={hint}>
        <span className="sl-meter__bar" role="img" aria-label={hint}>
          {segs.map((s) => <i key={s.k} className={`sl-seg sl-seg--${s.k}`} style={{ flexGrow: s.n }} />)}
        </span>
      </Hint>
      <span className="typo-caption">
        {total > 0 ? fill(LEDGER_COPY.meter.progress, { d: counts.decided, n: total }) : LEDGER_COPY.meter.empty}
      </span>
    </span>
  );
}
