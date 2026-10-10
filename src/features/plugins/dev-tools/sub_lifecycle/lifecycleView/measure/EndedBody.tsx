/**
 * The panel once the Measure ended, in two lines (the panel never outgrows
 * the status band's slot):
 *
 * 1. what the Measure changed for Gate and Tests, from the snapshot before
 *    against the one after ("Measured in 3m 12s: Gate At risk -> Healthy,
 *    Tests 12s faster and coverage +2 pts"), or that nothing changed; and the
 *    way to dismiss the panel;
 * 2. the first failure named with the way to its step; else how many commands
 *    a cancel left unrun; else every command as one outcome pill ("tsc 51s").
 */
import { CircleSlash, GitCompareArrows, X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { formatDuration } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../context';
import { ChangeParts } from '../history/changeText';
import { LT } from '../system/lcType';
import { Pill } from '../system/Pill';
import { RUN_LOOK } from '../system/pillLooks';
import { GLYPH } from '../system/scales';
import { FailureLine } from './FailureLine';
import { useMeasureSession } from './measureSession';
import type { MeasureOutcome } from './useMeasureOutcome';

const LINE = `flex h-7 min-w-0 items-center gap-2 ${LT.row}`;

function Chips({ outcome }: { outcome: MeasureOutcome }) {
  return (
    <span className="flex h-7 min-w-0 flex-1 flex-wrap items-center gap-1.5 overflow-hidden" data-testid="lc-measure-chips">
      {outcome.commands.map((c) => {
        const time = c.outcome !== 'did_not_run' && c.durationMs != null ? ` ${formatDuration(c.durationMs)}` : '';
        return c.outcome
          ? <Pill key={c.commandId} look={RUN_LOOK[c.outcome]} label={`${c.commandId}${time}`} data={{ 'data-outcome': c.outcome }} />
          : null;
      })}
    </span>
  );
}

function SecondLine({ outcome }: { outcome: MeasureOutcome }) {
  const { dl, tx } = useLifecycleViewModel();
  const [first, ...rest] = outcome.failures;
  if (first) return <FailureLine failure={first} more={rest.length} measureId={outcome.measureId} />;
  if (outcome.notRun > 0) {
    return (
      <p className={LINE} data-testid="lc-measure-cancelled">
        <CircleSlash className={`${GLYPH.sm} shrink-0`} aria-hidden />
        <span className="min-w-0 truncate">
          {outcome.notRun === 1 ? dl.lcx4_cancelled_one : tx(dl.lcx4_cancelled_many, { count: outcome.notRun })}
        </span>
      </p>
    );
  }
  return <Chips outcome={outcome} />;
}

export function EndedBody({ outcome }: { outcome: MeasureOutcome }) {
  const { dl, tx } = useLifecycleViewModel();
  const { dismiss } = useMeasureSession();
  const lead = tx(outcome.cancelled ? dl.lcx4_summary_lead_cancelled : dl.lcx4_summary_lead, { time: formatDuration(outcome.tookMs) });
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="lc-measure-summary">
      <div className="flex min-w-0 items-center gap-2">
        <p className={`flex-1 ${LINE}`} data-testid="lc-measure-changed">
          <GitCompareArrows className={`${GLYPH.sm} shrink-0 text-primary`} aria-hidden />
          <span className="min-w-0 truncate">
            {lead}{' '}
            {outcome.fragments.length > 0 ? <ChangeParts fragments={outcome.fragments} /> : dl.lcx4_summary_none}
          </span>
        </p>
        <Tooltip content={dl.lcx4_dismiss} placement="bottom">
          <Button variant="ghost" size="icon-sm" icon={<X className={GLYPH.sm} />} onClick={dismiss} aria-label={dl.lcx4_dismiss} data-testid="lc-measure-dismiss" />
        </Tooltip>
      </div>
      <SecondLine outcome={outcome} />
    </div>
  );
}
