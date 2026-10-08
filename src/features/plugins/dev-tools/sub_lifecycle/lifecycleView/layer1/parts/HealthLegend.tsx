// The verdict key: all six verdicts with their own glyph and ink, each with
// how many steps sit in it, so the legend is a truthful key to the view above.
import { ChipRow, type Chip } from '@/features/shared/components/kit';
import { Numeric } from '@/features/shared/components/display/Numeric';

import { useLifecycleViewModel } from '../../context';
import { HEALTH_ORDER, VERDICT, healthCounts, type HealthStep } from '../healthModel';
import { HEALTH_GLYPH, healthLabel } from '../layer1Labels';

export function HealthLegend({ steps }: { steps: HealthStep[] }) {
  const { dl } = useLifecycleViewModel();
  const counts = healthCounts(steps);
  const chips: Chip[] = HEALTH_ORDER.map((h) => {
    const Glyph = HEALTH_GLYPH[h];
    return {
      id: h,
      label: (
        <span className={`inline-flex items-center gap-1.5 ${VERDICT[h].ink}`} data-legend={h}>
          <Glyph className="h-4 w-4" aria-hidden />
          {healthLabel(dl, h)}
        </span>
      ),
      count: <Numeric value={counts[h]} />,
      share: steps.length ? counts[h] / steps.length : 0,
    };
  });
  return <ChipRow chips={chips} label={dl.lc1_legend_label} emptyLabel={null} />;
}
