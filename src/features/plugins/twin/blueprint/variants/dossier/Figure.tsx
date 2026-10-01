/**
 * Dossier (WP9): one figure on an instrument tile. A measured number renders
 * through `Numeric` (and counts up through `SpringCount` on a stage tile that
 * just took a delta); an unmeasured one (`null`) renders the honest "-" with
 * `data-measured="false"`, never a 0 and never the formatter's em dash.
 */
import { Numeric } from '@/features/shared/components/display/Numeric';
import { SpringCount } from '@/features/shared/components/display/SpringCount';
import { useTranslation } from '@/i18n/useTranslation';
import { formatNumeric } from '@/lib/utils/formatters';

interface FigureProps {
  value: number | null;
  /** `ratio` = a 0..1 share shown as a whole percent. */
  unit?: 'plain' | 'ratio';
  /** Count up to a new value (stage, the tile the last answer landed on). */
  spring?: boolean;
  /** Reduced motion: a new value snaps, it never counts. */
  reduced: boolean;
  className?: string;
  testId?: string;
}

export function Figure({ value, unit = 'plain', spring, reduced, className, testId }: FigureProps) {
  const { t, language } = useTranslation();
  const cls = className ?? 'typo-data';
  if (value === null) {
    return (
      <span className={`${cls} dossier-none`} data-measured="false" data-testid={testId} aria-label={t.twin.blueprint.states.notMeasured}>
        -
      </span>
    );
  }
  if (spring && !reduced) {
    const scaled = unit === 'ratio' ? Math.round(value * 100) : value;
    const format = unit === 'ratio' ? (n: number) => formatNumeric(n / 100, 'ratio', { precision: 0, language }) : undefined;
    return (
      <Numeric className={cls} as="span">
        <span data-measured="true" data-testid={testId}>
          <SpringCount value={scaled} format={format} />
        </span>
      </Numeric>
    );
  }
  return (
    <span data-measured="true" data-testid={testId}>
      <Numeric className={cls} value={value} unit={unit} precision={unit === 'ratio' ? 0 : undefined} />
    </span>
  );
}

/**
 * The "not measured" swatch: a hatched placeholder in the geometry the drawing
 * would take, so an unmeasured quantity never reads as an empty bar.
 */
export function NotMeasured({ width, height, testId }: { width: string; height: string; testId?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className="dossier-hatch"
      role="img"
      aria-label={t.twin.blueprint.states.notMeasured}
      data-measured="false"
      data-testid={testId}
      style={{ width, height }}
    />
  );
}
