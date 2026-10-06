/**
 * THESIS - STEPPER BESIDE: turn the journey on its side. A vertical stepper is
 * narrow, so the timeline costs a 15rem rail and the state panel plus the
 * evidence ledger get the whole remaining width at full height, SIDE BY SIDE
 * with the thing you clicked. Nothing scrolls between cause and explanation,
 * and each step row can afford its state word spelled out instead of encoded
 * in a border.
 *
 * The trade this makes against the baseline: you lose the left-to-right reading
 * of "before the task / after the task" as one continuous line, and you gain
 * every pixel of the right-hand side.
 */
import { useLifecycleViewModel } from '../context';
import { EvidenceLedger } from '../blocks/EvidenceLedger';
import { LifecycleActions } from '../blocks/LifecycleActions';
import { StateLegend } from '../blocks/StateLegend';
import { StepStepper } from '../blocks/StepStepper';
import { StepState } from '../blocks/StepState';

export function StepperBeside() {
  const { headline } = useLifecycleViewModel();

  return (
    <div className="space-y-4 pb-6" data-testid="lc-journey">
      <LifecycleActions />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(13rem,15rem)_1fr] gap-x-6 gap-y-5 items-start min-h-[32rem]">
        <div className="min-w-0 space-y-4 lg:border-r lg:border-primary/10 lg:pr-5">
          <StepStepper />
          <StateLegend align="start" />
        </div>

        <div className="min-w-0 space-y-4" data-testid="lc-state-region">
          <p className="typo-body text-foreground" data-testid="lc-weakest">{headline}</p>
          <StepState dense />
          <div className="h-[22rem]">
            <EvidenceLedger />
          </div>
        </div>
      </div>
    </div>
  );
}
