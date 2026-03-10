import type { TriggerHealth } from './triggerListTypes';
import { HEALTH_STYLES, HEALTH_TITLES } from './triggerListTypes';

export function HealthDot({ health }: { health: TriggerHealth }) {
  if (health === 'unknown') return null;
  return (
    <span
      title={HEALTH_TITLES[health]}
      className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${HEALTH_STYLES[health]}`}
    />
  );
}
