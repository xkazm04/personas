/**
 * A number on the radial surfaces: `<Numeric>` when measured, a plain "-" when
 * the model says `null`. Not measured is never drawn as 0, and the shared
 * formatter's own placeholder is an em dash, which app copy does not use.
 */
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';

interface RadialFigureProps {
  value: number | null;
  unit?: 'ratio' | 'count';
  className?: string;
}

export function RadialFigure({ value, unit = 'count', className }: RadialFigureProps) {
  const { t } = useTranslation();
  if (value === null) {
    return (
      <span className={className} data-measured="false" aria-label={t.twin.blueprint.states.notMeasured}>
        -
      </span>
    );
  }
  return <Numeric value={value} unit={unit} precision={unit === 'ratio' ? 0 : undefined} className={className} />;
}
