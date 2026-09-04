import { Gauge } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PressureGauge } from '@/lib/bindings/PressureGauge';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { formatCompactNumber } from '@/lib/utils/formatters';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

/**
 * The pressure gauge: unconsolidated characters against the auto-admission
 * threshold. One ratio against a limit is a METER, not a chart — same-ramp
 * track, the value written beside it.
 *
 * `charsWaiting` is always measured (the query ran), so a zero here is real
 * and says "nothing waiting". `lastCycleAt` is the honest-absence field: it
 * stays absent until a pass has actually completed, and is never backfilled
 * with an epoch.
 */
export function PressureTile({ pressure }: { pressure: PressureGauge }) {
  const { t } = useTranslation();
  const b = t.agents.brain;
  const { charsWaiting, threshold, lastCycleAt } = pressure;
  const ratio = threshold > 0 ? charsWaiting / threshold : 0;
  const over = ratio >= 1;
  const near = !over && ratio >= 0.75;
  const fillClass = over
    ? 'bg-status-warning'
    : near
      ? 'bg-status-info'
      : 'bg-primary/60';

  return (
    <SectionCard
      title={b.pressure_title}
      icon={<Gauge className="w-3.5 h-3.5 text-primary" aria-hidden />}
    >
      <div data-testid="brain-pressure">
        {/* ONE translated sentence with both numbers interpolated, never a
            fragment concatenated between two formatted numbers: the order of
            "waiting" and "of <threshold>" is not the same in every language,
            so a fragment cannot be translated correctly at all. */}
        <div className="flex items-baseline gap-2" data-testid="brain-pressure-waiting">
          <span className="typo-heading text-foreground">
            {b.pressure_waiting
              .replace('{waiting}', formatCompactNumber(charsWaiting))
              .replace('{threshold}', formatCompactNumber(threshold))}
          </span>
        </div>

        <div
          className="mt-2 h-2 w-full rounded-pill bg-secondary/40 overflow-hidden"
          role="meter"
          aria-valuenow={charsWaiting}
          aria-valuemin={0}
          aria-valuemax={threshold}
          aria-label={b.pressure_title}
        >
          <div
            className={`h-full rounded-pill transition-all ${fillClass}`}
            style={{ width: `${Math.min(100, ratio * 100)}%` }}
          />
        </div>

        <p className="mt-2 typo-caption text-foreground/85">
          {over ? b.pressure_over : charsWaiting === 0 ? b.pressure_idle : b.pressure_building}
        </p>

        <div className="mt-3 pt-3 border-t border-primary/10 flex items-center gap-2">
          <span className="typo-overline text-foreground/85">{b.pressure_last_cycle}</span>
          {lastCycleAt ? (
            <RelativeTime timestamp={lastCycleAt} className="typo-caption text-foreground" />
          ) : (
            // Honest absence — no pass has ever completed.
            <span className="typo-caption text-foreground/85">{b.pressure_never}</span>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
