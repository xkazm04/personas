/**
 * RAIL BELOW - the one arrangement, and the one the owner kept: the journey is a
 * horizontal two-lane rail read left to right, and the selected step's state is
 * docked in a reserved region directly beneath it. Nothing moves when you pick a
 * node; the page reads top-down, journey then state then evidence.
 *
 * This file owns the ARRANGEMENT and nothing else. Every visual decision lives
 * in the skin (`../skins`), because the owner's verdict on the previous round
 * was that the prototype axis should have been visual quality, not layout:
 * "Keep Rail below variant and redo the prototype round, the goal was to upgrade
 * component visual design and visual quality, not to keep components and
 * experiment with the layout." A skin cannot move a region, so this is the only
 * file that could, and there is one of it.
 *
 * The reserved region's min-height is held whether or not a step is selected, so
 * the state panel is never a block that appears and shoves the rail
 * (overview-loading law 6: a region is retired by its OWN data). The skin may
 * choose the two reserved heights but not whether they are reserved.
 *
 * VISUAL FIX, 2026-10-06: the weakest-step sentence - the single most important
 * line on the page, and the reason the model pre-seeds the selection - rendered
 * as `typo-body text-foreground`, exactly the legend footnote two rows below it,
 * with no trace of the severity the model had already computed. It now reads one
 * type step up and carries the weakest step's own status ink.
 */
import { JourneyGhost } from '../../journey/JourneyGhost';
import { STATE_TEXT } from '../../journey/journeyStyles';
import { useLifecycleViewModel } from '../context';
import { EvidenceLedger } from '../blocks/EvidenceLedger';
import { LifecycleActions } from '../blocks/LifecycleActions';
import { StateLegend } from '../blocks/StateLegend';
import { StepRail } from '../blocks/StepRail';
import { StepState } from '../blocks/StepState';
import { useSkin } from '../skins';

export function RailBelow() {
  const { headline, headlineState, order, loading } = useLifecycleViewModel();
  const skin = useSkin();
  const ink = skin.headlineStatusInk && headlineState ? STATE_TEXT[headlineState] : 'text-foreground';

  return (
    <div className={`${skin.pageGap} pb-6`} data-testid="lc-journey">
      <LifecycleActions />

      <div className={skin.headlineWrap}>
        <p className={`${skin.headlineType} ${ink}`} data-testid="lc-weakest">{headline}</p>
      </div>

      {order.length > 0 ? <StepRail /> : loading ? <JourneyGhost /> : null}

      <StateLegend />

      <div className={`${skin.regionMinHeight} ${skin.regionWrap}`} data-testid="lc-state-region">
        <StepState />
        <div className={skin.ledgerHeight}>
          <EvidenceLedger />
        </div>
      </div>
    </div>
  );
}
