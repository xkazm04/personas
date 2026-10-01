/**
 * A number on the strata surfaces: `<Numeric>` when measured, a plain "-" when
 * the model says `null` (not measured is never drawn as 0, and the shared
 * formatter's placeholder is an em dash, which app copy does not use).
 */
import { Numeric } from '@/features/shared/components/display/Numeric';

export function StrataFigure({ value, unit, className }: { value: number | null; unit?: 'ratio'; className?: string }) {
  if (value === null) {
    return (
      <span className={className} data-measured="false">
        -
      </span>
    );
  }
  return (
    <Numeric
      value={value}
      unit={unit === 'ratio' ? 'ratio' : 'count'}
      precision={unit === 'ratio' ? 0 : undefined}
      className={className}
    />
  );
}
