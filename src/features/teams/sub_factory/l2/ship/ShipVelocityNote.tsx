// The milestone workspace's cycle-time line: how long this project actually
// takes from cut to ship, and when the selected milestone is forecast to land.
// Derived entirely from dev_milestones timestamps (shipVelocity.ts): nothing
// is typed in, and below the evidence bar it says so instead of guessing.
import { Gauge } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { DevMilestone } from '@/lib/bindings/DevMilestone';

import { INK } from '../../passport/passportInk';
import type { ShipMilestoneVM } from './shipModel';
import { deriveShipVelocity } from './shipVelocity';

export function ShipVelocityNote({ rows, vm }: {
  /** Every milestone row in the project: the cycle-time evidence. */
  rows: DevMilestone[];
  vm: ShipMilestoneVM;
}) {
  const { t, tx } = useTranslation();

  // A shipped milestone has a real date; a forecast for it would be noise.
  if (vm.status === 'shipped') return null;

  const velocity = deriveShipVelocity(rows);
  if (!velocity) {
    return (
      <p className="typo-caption mt-2" data-testid="ship-velocity-none">{t.ship.velocity_no_history}</p>
    );
  }

  const forecast = velocity.forecast?.milestoneId === vm.id ? velocity.forecast : null;

  return (
    <p className="typo-caption mt-2 flex items-center gap-1.5 flex-wrap" data-testid="ship-velocity">
      <Gauge className="w-3.5 h-3.5 shrink-0" style={{ color: INK.blue }} aria-hidden />
      <span className="tabular-nums">
        {tx(t.ship.velocity_typical, { days: velocity.medianDays, count: velocity.sampleSize })}
      </span>
      {forecast && (
        <>
          <span aria-hidden>·</span>
          <span className="tabular-nums" style={{ color: INK.teal }} data-testid="ship-velocity-forecast">
            {tx(forecast.basis === 'cut' ? t.ship.velocity_forecast_cut : t.ship.velocity_forecast_today, { date: forecast.date })}
          </span>
          {forecast.late && forecast.targetDate && (
            <span className="tabular-nums" style={{ color: INK.amber }} data-testid="ship-velocity-late">
              {tx(t.ship.velocity_past_target, { date: forecast.targetDate })}
            </span>
          )}
        </>
      )}
    </p>
  );
}
