import { StatusShape, mapToShapeStatus } from '@/features/shared/components/display/StatusShape';
import type { TriggerHealth } from './triggerListTypes';
import { HEALTH_TITLES } from './triggerListTypes';

const HEALTH_ANIMATION: Partial<Record<TriggerHealth, string>> = {
  healthy: 'animate-[health-pulse_2s_ease-in-out_infinite]',
  failing: 'animate-[health-pulse_1.5s_ease-in-out_infinite]',
};

export function HealthDot({ health }: { health: TriggerHealth }) {
  if (health === 'unknown') return null;
  return (
    <StatusShape
      status={mapToShapeStatus(health)}
      size="xs"
      title={HEALTH_TITLES[health]}
      className={HEALTH_ANIMATION[health] ?? ''}
    />
  );
}
