// The module's ONE count badge: a tray's step count, a legend's per-state
// count, a tally. Before it a tray's count was raised (elevation) and the
// legend's was sunken (inner shadow) for the same job.
import { Numeric } from '@/features/shared/components/display/Numeric';

import { LC_COUNT } from './lcSurface';
import { LT } from './lcType';

export function Count({ value, label }: { value: number; label?: string }) {
  return (
    <span className={LC_COUNT} aria-label={label}>
      <Numeric value={value} className={LT.metaNum} />
    </span>
  );
}
