// A step's health verdict as a pill: the verdict's own glyph, label, stroke
// and fill (`healthModel.VERDICT`), so all six read apart without colour.
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';

import { useLifecycleViewModel } from '../../context';
import { VERDICT } from '../healthModel';
import { HEALTH_GLYPH, healthLabel } from '../layer1Labels';

export function VerdictBadge({ health, size = 'md' }: { health: LifecycleHealth; size?: 'md' | 'lg' }) {
  const { dl } = useLifecycleViewModel();
  const v = VERDICT[health];
  const Glyph = HEALTH_GLYPH[health];
  const box = size === 'lg' ? 'gap-2 px-3 py-1 typo-heading' : 'gap-1.5 px-2.5 py-0.5 typo-label';
  return (
    <span
      data-health={health}
      className={`inline-flex shrink-0 items-center rounded-pill ${box} ${v.ink} ${v.outline} ${v.wash}`}
    >
      <Glyph className={size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} aria-hidden />
      {healthLabel(dl, health)}
    </span>
  );
}
