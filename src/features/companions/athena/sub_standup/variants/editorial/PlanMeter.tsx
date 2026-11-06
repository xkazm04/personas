import { Hint } from '@/features/shared/components/kit';
import type { Counts } from '../../model/types';
import { ED_COPY, fill } from './copy';

/**
 * The plan as a typographic fraction ("2 of 10 decided") over a 3px bar: waits | proposed |
 * decided | running, each segment as wide as its count and drawn in its own mark (solid red,
 * dotted amber, solid primary, still green hatch).
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
  const hint = fill(ED_COPY.meter.hint, { w: counts.waits, p: counts.proposed, d: counts.decided, r: counts.running });
  return (
    <Hint content={hint}>
      <span className="se-meter" role="img" aria-label={hint}>
        {total > 0 ? (
          <span className="se-frac se-num">
            <span className="se-frac__n">{counts.decided}</span>
            <span className="se-frac__of">{ED_COPY.meter.of} {total}</span>
            <span className="se-sc">{ED_COPY.meter.decided}</span>
          </span>
        ) : <span className="se-frac__of">{ED_COPY.meter.empty}</span>}
        <span className="se-meter__bar">
          {segs.map((s) => <i key={s.k} className={`se-seg se-seg--${s.k}`} style={{ flexGrow: s.n }} />)}
        </span>
      </span>
    </Hint>
  );
}
