/**
 * DIAL - the lifecycle as the cycle its own name claims it is.
 *
 * The bet: a practice is not a line with an end, it is a loop the next task
 * enters at the top, and the first thing the operator needs is the SHAPE of his
 * enforcement - how much of the loop is armed, and where the open arcs are. The
 * crown answers that in one glance and the hub states the denominator on the
 * figure: `enforced / total`.
 *
 * Position is not lost, it is made cyclical: 12 o'clock is step one, the arc
 * clockwise from a step is what is ahead of it, the arc behind is what is done,
 * and the two lanes are separated by a wide gap at each boundary so the
 * before/after split is a shape rather than an announcement.
 *
 * Beside the dial, not under it: the selected step's rule and bindings and its
 * evidence ledger sit in a column to the right at wide widths, so picking a step
 * never moves the figure and the figure never pushes the reading down the page.
 * Under `lg` the column stacks beneath the dial, which is the only honest move
 * for a 352px figure on a narrow surface. The detail column holds a reserved
 * height, so the ledger's cold load does not resize the row (law 6).
 *
 * The lane names are a key under the dial rather than labels inside it: at this
 * radius the annulus between the hub and the ring is 33px tall and a lane name
 * is 56px wide, so an in-figure label would have collided with the step
 * captions. The groups still carry the lane names for a screen reader.
 */
import { STATE_TEXT } from '../../../journey/journeyStyles';
import { useLifecycleViewModel } from '../../context';
import { EvidenceLedger } from '../../blocks/EvidenceLedger';
import { LifecycleActions } from '../../blocks/LifecycleActions';
import { StateLegend } from '../../blocks/StateLegend';
import { StepState } from '../../blocks/StepState';
import { DialGhost } from './DialGhost';
import { DialRing } from './DialRing';

const PLATE = 'rounded-card border border-primary/15 bg-primary/[0.02]';

export function Dial() {
  const { dl, headline, headlineState, order, loading } = useLifecycleViewModel();
  const ink = headlineState ? STATE_TEXT[headlineState] : 'text-foreground';

  return (
    <div className="space-y-4 pb-6" data-testid="lc-journey">
      <LifecycleActions />

      <section className={`${PLATE} p-5`}>
        <header className="space-y-1 border-b border-primary/10 pb-3">
          <h2 className="typo-section-title">{dl.lc_journey_label}</h2>
          <p className={`typo-body-lg ${ink}`} data-testid="lc-weakest">{headline}</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[22rem_1fr] gap-x-8 gap-y-5 pt-4 items-start">
          <div className="space-y-3">
            {order.length > 0 ? <DialRing /> : loading ? <DialGhost /> : null}
            <div className="flex items-center justify-center gap-5">
              {[dl.lc_lane_before, dl.lc_lane_after].map((name, i) => (
                <span key={name} className="flex items-center gap-2 typo-label text-foreground">
                  <span
                    aria-hidden
                    className={`w-5 h-1.5 rounded-full ${i === 0 ? 'bg-primary/55' : 'bg-primary/25'}`}
                  />
                  {name}
                </span>
              ))}
            </div>
            <StateLegend />
          </div>

          <div className="min-w-0 min-h-[24rem] space-y-4" data-testid="lc-state-region">
            <StepState columns={false} />
            <div className="h-[13rem]">
              <EvidenceLedger />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
