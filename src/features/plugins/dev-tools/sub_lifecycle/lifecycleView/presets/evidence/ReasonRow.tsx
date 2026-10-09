/**
 * One reason a step was missed, ranked: the note as its changes wrote it most,
 * how many changes gave it ("×7") on a bar whose length is its share of all
 * the misses, how many of them FAILED rather than skipped, the other ways it
 * was written, and "Ask Athena" with the step, the reason, the counts and two
 * examples already in the question.
 */
import { Sparkles } from 'lucide-react';

import { useAskAthena } from '@/features/companions/athena/useAskAthena';
import { Button } from '@/features/shared/components/buttons';

import { stepLabel } from '../../../journey/journeyLabels';
import type { JourneyNode } from '../../../journey/journeyModel';
import { useLifecycleViewModel } from '../../context';
import { lcSurface } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { GLYPH } from '../../system/scales';
import type { ReasonCluster } from './reasons';

/** Examples handed to Athena with the reason. */
const ASKED_EXAMPLES = 2;

export function ReasonRow({ cluster: c, missed, node, rank }: { cluster: ReasonCluster; missed: number; node: JourneyNode; rank: number }) {
  const { dl, tx, projectId, projectName } = useLifecycleViewModel();
  const ask = useAskAthena();
  const share = missed > 0 ? c.count / missed : 0;
  const others = c.examples.filter((e) => e !== c.label);
  const question = tx(dl.lcx8_ask_reason, {
    step: stepLabel(dl, node.id, node.label),
    name: projectName ?? '',
    id: projectId ?? '',
    count: c.count,
    missed,
    reason: c.label,
    examples: c.examples.slice(0, ASKED_EXAMPLES).join('; '),
  });
  return (
    <li className={`${lcSurface('card')} flex flex-col gap-2`} data-testid={`lc8-reason-${rank}`} data-count={c.count}>
      <div className="flex items-center gap-3">
        <p className={`min-w-0 flex-1 break-words ${LT.row}`}>{c.label}</p>
        <span className={`shrink-0 ${LT.rowNum} ${c.failed > c.skipped ? 'text-status-error' : 'text-status-warning'}`}>
          {tx(dl.lcx8_reason_times, { count: c.count })}
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={<Sparkles className={GLYPH.sm} />}
          onClick={() => ask('lifecycle', question)}
          data-testid={`lc8-reason-ask-${rank}`}
        >
          {dl.lcx8_reason_ask}
        </Button>
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-pill bg-secondary/60"
        role="img"
        aria-label={tx(dl.lcx8_reason_share, { count: c.count, missed })}
      >
        <div
          className={`h-full rounded-pill transition-[width] duration-300 motion-reduce:transition-none ${c.failed > c.skipped ? 'bg-status-error' : 'bg-status-warning'}`}
          style={{ width: `${Math.max(2, Math.round(share * 100))}%` }}
        />
      </div>
      {(c.failed > 0 || others.length > 0) && (
        <div className={`flex flex-wrap gap-x-4 gap-y-1 ${LT.meta}`}>
          {c.failed > 0 && <span className="text-status-error">{tx(dl.lcx8_reason_failed, { count: c.failed })}</span>}
          {others.length > 0 && <span className="min-w-0 break-words">{tx(dl.lcx8_reason_example, { text: others.join('; ') })}</span>}
        </div>
      )}
    </li>
  );
}
