// A Measure as one segmented track: a segment per planned command, in plan
// order. Waiting is a faint segment, running is the accent with a streak
// (the warning tone once it runs past 1.5x its median), done is its outcome's
// tone - and a run that never happened is an open dashed segment, never a
// filled one. While the plan resolves (no commands yet) the track is one
// faint bar with the streak. Drawn only: the control around it says the count.
import type { LifecycleCommandProgress } from '@/lib/bindings/LifecycleCommandProgress';

import type { PillTone } from '../system/pillLooks';
import { METER } from '../system/scales';
import { segmentTone, type SegmentTone } from './measureModel';
import { Streak } from './Streak';

const OUTCOME_FILL: Record<PillTone, string> = {
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  error: 'bg-status-error',
  info: 'bg-status-info',
  neutral: 'border border-dashed border-foreground/60',
  quiet: 'bg-primary/30',
};

const FILL: Record<SegmentTone, string> = {
  pending: 'bg-foreground/15',
  running: 'bg-primary',
  over: 'bg-status-warning',
  ...OUTCOME_FILL,
};

export function SegmentTrack({ commands, now }: { commands: LifecycleCommandProgress[]; now: number }) {
  if (commands.length === 0) {
    return (
      <span aria-hidden className={`relative block w-full ${METER.track} rounded-pill bg-foreground/15`} data-segments="0">
        <Streak />
      </span>
    );
  }
  return (
    <span aria-hidden className="flex w-full gap-0.5" data-segments={commands.length}>
      {commands.map((c) => {
        const tone = segmentTone(c, now);
        return (
          <span
            key={c.commandId}
            className={`relative block min-w-0 flex-1 ${METER.track} rounded-pill ${FILL[tone]}`}
            data-segment={tone}
          >
            {(tone === 'running' || tone === 'over') && <Streak />}
          </span>
        );
      })}
    </span>
  );
}
