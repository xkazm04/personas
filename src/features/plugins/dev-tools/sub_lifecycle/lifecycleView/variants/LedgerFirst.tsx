/**
 * THESIS - LEDGER FIRST: the evidence table IS the page. The journey is a
 * single dense header strip of chips above it, the selected step's rule and
 * bindings are one compact band under that, and everything below is ledger.
 *
 * The argument: you come to this surface to answer "what actually happened to
 * my practice", and the answer lives in the rows. The baseline spends roughly
 * half its vertical budget drawing a diagram whose information content is the
 * same eleven states the strip carries in one row. This variant is the honest
 * version of that trade - and it is the only one of the three where the ledger
 * gets enough rows on screen to sort usefully.
 */
import { useLifecycleViewModel } from '../context';
import { EvidenceLedger } from '../blocks/EvidenceLedger';
import { LifecycleActions } from '../blocks/LifecycleActions';
import { StepState } from '../blocks/StepState';
import { StepStrip } from '../blocks/StepStrip';

export function LedgerFirst() {
  const { headline, order } = useLifecycleViewModel();

  return (
    <div className="space-y-4 pb-6" data-testid="lc-journey">
      <LifecycleActions />

      {order.length > 0 && (
        <div className="border-b border-primary/10 pb-1">
          <StepStrip />
        </div>
      )}

      <p className="typo-caption text-foreground" data-testid="lc-weakest">{headline}</p>

      <div className="min-h-[34rem] space-y-3" data-testid="lc-state-region">
        <div className="rounded-card border border-primary/10 bg-primary/[0.03] px-4 py-3">
          <StepState dense />
        </div>
        <div className="h-[24rem]">
          <EvidenceLedger />
        </div>
      </div>
    </div>
  );
}
