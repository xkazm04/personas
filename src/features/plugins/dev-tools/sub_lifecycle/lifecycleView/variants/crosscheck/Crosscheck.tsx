/**
 * CROSSCHECK - the lifecycle as the RECORD it produced.
 *
 * The bet: the first thing an operator needs when he opens a project's practice
 * is not where the task is in the sequence (he knows that) but whether the
 * practice is actually happening. So the material is containered as a crosstab:
 * every step against every recent change, the whole snapshot at once, with each
 * step's hit rate on its own row. The sequence is still the row order and the
 * two lanes are still two groups, so position is not lost - it is just no longer
 * the figure.
 *
 * Two plates, not one layer: the record is the upper surface and the selected
 * step's rule, bindings and evidence are a second surface under it, because the
 * evidence is the heavy content and heavy content gets its own surface.
 *
 * The step's state panel is dense here on purpose: the figure above already
 * answered "how often", so the panel answers only "what is installed and what
 * does the agent get told", which is two short columns.
 */
import { useMemo } from 'react';

import { STATE_TEXT } from '../../../journey/journeyStyles';
import { useLifecycleViewModel } from '../../context';
import { EvidenceLedger } from '../../blocks/EvidenceLedger';
import { LifecycleActions } from '../../blocks/LifecycleActions';
import { StateLegend } from '../../blocks/StateLegend';
import { StepState } from '../../blocks/StepState';
import { CrosscheckGhost } from './CrosscheckGhost';
import { CrosscheckGrid } from './CrosscheckGrid';
import { crosscheckMatrix } from './crosscheck.model';

/** Both plates: one border vocabulary, so the page reads as two levels. */
const PLATE = 'rounded-card border border-primary/15 bg-primary/[0.02]';

export function Crosscheck() {
  const { dl, headline, headlineState, order, evidence, loading } = useLifecycleViewModel();
  const matrix = useMemo(() => crosscheckMatrix(order, evidence), [order, evidence]);
  const ink = headlineState ? STATE_TEXT[headlineState] : 'text-foreground';

  return (
    <div className="space-y-4 pb-6" data-testid="lc-journey">
      <LifecycleActions />

      <section className={`${PLATE} p-4 space-y-3`} aria-label={dl.lc_journey_label}>
        <header className="space-y-1">
          <h2 className="typo-section-title">{dl.lc_journey_label}</h2>
          <p className={`typo-body-lg ${ink}`} data-testid="lc-weakest">{headline}</p>
        </header>

        {order.length > 0 ? <CrosscheckGrid matrix={matrix} /> : loading ? <CrosscheckGhost /> : null}

        <footer className="border-t border-primary/10 pt-3">
          <StateLegend />
        </footer>
      </section>

      <section className={`${PLATE} p-4 space-y-4 min-h-[22rem]`} data-testid="lc-state-region">
        <StepState />
        <div className="h-[14rem]">
          <EvidenceLedger />
        </div>
      </section>
    </div>
  );
}
