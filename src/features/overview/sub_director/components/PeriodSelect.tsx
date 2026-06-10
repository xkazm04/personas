import { useTranslation } from '@/i18n/useTranslation';

/**
 * Compact value-rollup window picker for the scorecard subheader. Wires the
 * `days` param that the portfolio command always accepted but the UI never
 * exposed — letting the user scope every KPI, the distribution, and model
 * efficiency to a 7 / 30 / 90-day window. The active pill reflects the
 * *effective* window (selected, or the backend default once data loads).
 */

const OPTIONS = [7, 30, 90];

export function PeriodSelect({
  value,
  onChange,
}: {
  /** Effective window in days (selected value, or the loaded portfolio's). */
  value: number | null;
  onChange: (days: number) => void;
}) {
  const { t, tx } = useTranslation();
  return (
    <div
      role="group"
      aria-label={t.director.period_label}
      className="inline-flex items-center gap-0.5 rounded-pill border border-primary/10 bg-secondary/30 p-0.5"
    >
      {OPTIONS.map((d) => {
        const active = value === d;
        return (
          <button
            key={d}
            type="button"
            onClick={() => onChange(d)}
            aria-pressed={active}
            className={`px-2 py-0.5 rounded-pill typo-caption tabular-nums transition-colors focus-ring ${
              active ? 'bg-violet-500/20 text-violet-100' : 'text-foreground hover:bg-secondary/50'
            }`}
          >
            {tx(t.director.period_days, { count: d })}
          </button>
        );
      })}
    </div>
  );
}
