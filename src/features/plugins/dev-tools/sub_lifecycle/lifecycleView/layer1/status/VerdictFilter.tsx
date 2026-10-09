// The verdict key as a filter: each verdict's glyph (in its ink) and how many
// steps sit in it. Resting on a count previews those steps on the rail (the
// others dim their surface); pressing it pins the highlight (the count reads
// pressed); pressing again or Esc clears it. A verdict no step has is shown,
// so the key stays a complete key, but takes no press.
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { ButtonTone } from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';

import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';
import { GLYPH } from '../../system/scales';
import { HEALTH_ORDER, VERDICT, healthCounts, type HealthStep } from '../healthModel';
import { useHighlight } from '../highlight';
import { HEALTH_GLYPH, healthLabel } from '../layer1Labels';

/** A pinned count's tint: the verdict's status tone, or the neutral accent for the two quiet verdicts. */
const PINNED_TONE: Partial<Record<LifecycleHealth, ButtonTone>> = {
  green: 'success', amber: 'warning', red: 'error', stale: 'info',
};

export function VerdictFilter({ steps }: { steps: HealthStep[] }) {
  const { dl, tx } = useLifecycleViewModel();
  const { pinned, preview, toggle } = useHighlight();
  const counts = healthCounts(steps);
  return (
    <div role="group" aria-label={dl.lc1_legend_label} className="flex flex-wrap items-center gap-0.5" data-testid="lc-legend">
      {HEALTH_ORDER.map((h) => {
        const Glyph = HEALTH_GLYPH[h];
        const on = pinned === h;
        const label = counts[h] === 1
          ? tx(dl.lcx2_filter_label_one, { verdict: healthLabel(dl, h) })
          : tx(dl.lcx2_filter_label, { verdict: healthLabel(dl, h), count: counts[h] });
        const button = (
          <Button
            variant={on ? 'accent' : 'ghost'}
            tone={on ? PINNED_TONE[h] : undefined}
            size="sm"
            aria-pressed={on}
            aria-label={label}
            disabled={counts[h] === 0}
            onClick={() => toggle(h)}
            onPointerEnter={() => preview(h)}
            onPointerLeave={() => preview(null)}
            onFocus={() => preview(h)}
            onBlur={() => preview(null)}
            data-legend={h}
            icon={<Glyph className={`${GLYPH.sm} ${VERDICT[h].ink}`} aria-hidden />}
          >
            <Numeric value={counts[h]} className={LT.rowNum} />
          </Button>
        );
        return counts[h] === 0 ? <span key={h}>{button}</span> : <Tooltip key={h} content={label}>{button}</Tooltip>;
      })}
    </div>
  );
}
