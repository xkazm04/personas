import { Hint } from '@/features/shared/components/kit';
import type { Counts } from '../../model/types';
import { fill, STUDIO_COPY } from './copy';

/**
 * The plan as a segmented capsule beside one large figure: waits | proposed |
 * decided | running, each segment as wide as its count and drawn in the badge
 * treatment it stands for (error tint, dashed warning, primary gradient,
 * still success hatch). The figure is the decided count over the plan.
 */
export function PlanMeter({ counts }: { counts: Counts }) {
  const M = STUDIO_COPY.meter;
  const running = Math.min(counts.running, counts.decided);
  const segs = [
    { k: 'waits', n: counts.waits },
    { k: 'proposed', n: counts.proposed },
    { k: 'decided', n: counts.decided - running },
    { k: 'running', n: running },
  ].filter((s) => s.n > 0);
  const total = counts.proposed + counts.decided;
  const hint = fill(M.hint, { w: counts.waits, p: counts.proposed, d: counts.decided, r: counts.running });
  return (
    <Hint content={hint}>
      <span className="ss-meter" role="img" aria-label={hint}>
        {total > 0 ? (
          <span className="ss-meter__fig">
            <span className="ss-meter__big">{counts.decided}</span>
            <span className="ss-meter__of">{fill(M.of, { n: total })}</span>
            <span className="ss-meter__cap">{M.caption}</span>
          </span>
        ) : (
          <span className="ss-meter__cap">{M.empty}</span>
        )}
        <span className="ss-meter__bar">
          {segs.map((s) => <i key={s.k} className={`ss-seg ss-seg--${s.k}`} style={{ flexGrow: s.n }} />)}
        </span>
      </span>
    </Hint>
  );
}
