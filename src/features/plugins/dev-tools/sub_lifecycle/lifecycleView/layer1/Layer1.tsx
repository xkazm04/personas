/**
 * LAYER 1 - the whole practice at a glance: the headline plate (the step with
 * the worst measured verdict), the COLLAR RAIL (the owner's pick of the WP3
 * round, 2026-10-08: the Tactile rail's key caps on their groove, each wearing
 * a collar with its verdict and metrics), and the binding / evidence key.
 *
 * Pressing a key opens that step's Layer-2 screen in place of this one. The
 * old lower half (the selected step's state panel and the evidence ledger) is
 * gone from here: everything it said lives on the step's own screen now, where
 * it has room (`layer2/StepScreen`).
 */
import { CollarView } from './collar/CollarView';
import { BindingLegend } from './parts/BindingLegend';
import { HeadlinePlate } from './parts/HeadlinePlate';

export function Layer1() {
  return (
    <div className="space-y-5" data-testid="lc1-layer1">
      <HeadlinePlate />
      <CollarView />
      <BindingLegend />
    </div>
  );
}
