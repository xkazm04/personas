/**
 * Why the step was missed: the notes of the changes that skipped or failed
 * it, grouped by what they say (`reasons.ts`), biggest first, the top
 * {@link REASON_CAP} as ranked rows; how many smaller reasons are left; and
 * how many misses left no note at all, which is its own finding. Not drawn
 * when nothing was missed.
 */
import { Section } from '@/features/shared/components/kit';

import type { JourneyNode } from '../../../journey/journeyModel';
import { useLifecycleViewModel } from '../../context';
import { Count } from '../../system/Count';
import { LT } from '../../system/lcType';
import { ReasonRow } from './ReasonRow';
import type { ReasonSummary } from './reasons';

/** Reasons ranked as rows; the rest are counted. */
export const REASON_CAP = 5;

export function ReasonsSection({ reasons, node }: { reasons: ReasonSummary; node: JourneyNode }) {
  const { dl, tx } = useLifecycleViewModel();
  const { clusters, missed, unexplained } = reasons;
  if (missed === 0) return null;
  const shown = clusters.slice(0, REASON_CAP);
  const rest = clusters.length - shown.length;
  return (
    <Section
      title={dl.lcx8_reasons_title}
      level={2}
      count={missed}
      desc={missed === 1 ? dl.lcx8_reasons_desc_one : tx(dl.lcx8_reasons_desc, { missed })}
    >
      <div className="k-in space-y-2" data-testid="lc8-reasons">
        {shown.length > 0 && (
          <ol className="grid gap-2">
            {shown.map((c, i) => <ReasonRow key={c.key} cluster={c} missed={missed} node={node} rank={i} />)}
          </ol>
        )}
        {(rest > 0 || unexplained > 0) && (
          <div className={`flex flex-wrap items-center gap-x-6 gap-y-1 px-3 ${LT.meta}`}>
            {rest > 0 && <span data-testid="lc8-reasons-more">{rest === 1 ? dl.lcx8_reason_more_one : tx(dl.lcx8_reason_more, { count: rest })}</span>}
            {unexplained > 0 && (
              <span className="inline-flex items-center gap-2" data-testid="lc8-reasons-unexplained">
                <Count value={unexplained} />
                {dl.lcx8_reason_unexplained}
              </span>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}
