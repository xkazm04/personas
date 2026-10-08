// The key to the two marks a collar's key cap still carries that the health
// legend does not explain: the binding state on the cap's indicator strip
// (each with its step count) and the evidence beads under it.
import { Numeric } from '@/features/shared/components/display/Numeric';

import { bindingStateLabel } from '../../../journey/journeyLabels';
import { LEGEND_STATES } from '../../../journey/journeyStyles';
import { useLifecycleViewModel } from '../../context';
import { OUTCOMES, stateCounts } from '../../railShared';
import { BeadTrack, MiniKey } from '../../TactileKeys';

export function BindingLegend() {
  const { dl, order } = useLifecycleViewModel();
  const counts = stateCounts(order);
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2" data-testid="lc-legend">
      {LEGEND_STATES.map((s) => (
        <span key={s} className="flex items-center gap-2 typo-label text-foreground">
          <MiniKey state={s} />
          {bindingStateLabel(dl, s)}
          <Numeric value={counts[s]} className="typo-caption rounded-full bg-secondary/50 px-1.5 shadow-inner" />
        </span>
      ))}
      <span className="flex items-center gap-2 typo-caption">
        <BeadTrack beads={OUTCOMES.map((o) => ({ key: o, outcome: o }))} delay={0.4} />
        {dl.lc_legend_evidence}
      </span>
    </div>
  );
}
