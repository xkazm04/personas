/**
 * The status band's lead while a past Measure is viewed, in place of the
 * weakest-step sentence: which Measure the page is showing (when, on which
 * commit) and the way back. The rest of the band - the goal and the verdict
 * counts - already counts that Measure's Gate and Tests, and a reader hears
 * that too. One line at the height of the sentence it replaces, so the rail
 * under the band does not move.
 */
import { ArrowRightToLine, History } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { LifecycleMeasureColumn } from '@/lib/bindings/LifecycleMeasureColumn';

import { useLifecycleViewModel } from '../context';
import { fillTemplate } from '../frame/fillTemplate';
import { LT } from '../system/lcType';
import { GLYPH } from '../system/scales';
import { shortSha } from './parts/Axis';
import { useTimeTravel } from './timeTravel';

export function TravelLead({ column }: { column: LifecycleMeasureColumn }) {
  const { dl } = useLifecycleViewModel();
  const { travel } = useTimeTravel();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" data-testid="lc-travel-lead" data-measure={column.measureId}>
      <p className={`flex min-w-0 items-center gap-2.5 text-primary ${LT.row}`}>
        <History className={`${GLYPH.md} shrink-0`} aria-hidden />
        <span className="min-w-0">
          {fillTemplate(dl.lcx3_viewing, {
            time: <RelativeTime timestamp={column.finishedAt} />,
            sha: <span className={LT.code}>{shortSha(column.headSha)}</span>,
          })}
          <span className="sr-only">{` ${dl.lcx3_viewing_scope}`}</span>
        </span>
      </p>
      <Button
        variant="secondary"
        size="xs"
        icon={<ArrowRightToLine className={GLYPH.sm} />}
        onClick={() => travel(null)}
        data-testid="lc-travel-back"
      >
        {dl.lcx3_back_to_now}
      </Button>
    </div>
  );
}
