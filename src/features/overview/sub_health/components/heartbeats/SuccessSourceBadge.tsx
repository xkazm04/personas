import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { PersonaHealthSignal } from '@/stores/slices/overview/personaHealthSlice';

// ---------------------------------------------------------------------------
// Success-rate provenance badge. A persona's success rate is only trustworthy
// when it was MEASURED from that persona's own runs. When we had to fall back
// to the fleet-wide average ('proxy') or have no data at all ('unknown'), the
// number must not masquerade as a per-persona truth — this chip says so.
// ---------------------------------------------------------------------------

export function SuccessSourceBadge({
  source,
  className,
}: {
  source: PersonaHealthSignal['successRateSource'];
  className?: string;
}) {
  const { t } = useTranslation();
  const h = t.overview.heartbeats;

  if (source === 'measured') return null;

  const label = source === 'proxy' ? h.fleet_avg_badge : h.no_data_badge;
  const tip = source === 'proxy' ? h.fleet_avg_tooltip : h.no_data_tooltip;

  return (
    <Tooltip content={tip}>
      <span
        className={`inline-flex items-center rounded-interactive border border-primary/10 bg-secondary/40 px-1.5 py-0.5 typo-caption text-foreground ${className ?? ''}`}
      >
        {label}
      </span>
    </Tooltip>
  );
}
