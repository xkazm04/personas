/**
 * THESIS - RAIL BELOW (the baseline): keep the journey exactly where it is, a
 * horizontal two-lane rail read left to right, and dock the selected step's
 * state in a reserved region directly beneath it. Nothing moves when you pick a
 * node; the page reads top-down, journey then state then evidence.
 *
 * This is the variant to compare the other two against: the rail, the legend
 * and the weakest-step line are the surface as it shipped. The one change is
 * that a node no longer opens a drawer.
 */
import { JourneyGhost } from '../../journey/JourneyGhost';
import { useLifecycleViewModel } from '../context';
import { EvidenceLedger } from '../blocks/EvidenceLedger';
import { LifecycleActions } from '../blocks/LifecycleActions';
import { StateLegend } from '../blocks/StateLegend';
import { StepRail } from '../blocks/StepRail';
import { StepState } from '../blocks/StepState';

export function RailBelow() {
  const { headline, order, loading } = useLifecycleViewModel();

  return (
    <div className="space-y-5 pb-6" data-testid="lc-journey">
      <LifecycleActions />

      <p className="typo-body text-foreground text-center" data-testid="lc-weakest">{headline}</p>

      {order.length > 0 ? <StepRail /> : loading ? <JourneyGhost /> : null}

      <StateLegend />

      {/* The reserved region. Its min-height is held whether or not a step is
          selected, so the state panel is never a block that appears and shoves
          the rail (overview-loading law 6: a region is retired by its OWN data). */}
      <div className="min-h-[26rem] space-y-4 border-t border-primary/10 pt-4" data-testid="lc-state-region">
        <StepState />
        <div className="h-[17rem]">
          <EvidenceLedger />
        </div>
      </div>
    </div>
  );
}
