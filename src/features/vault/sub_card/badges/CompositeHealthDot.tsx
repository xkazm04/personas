import { useMemo } from 'react';
import type { RotationStatus } from '@/api/vault/rotation';
import type { HealthResult } from '@/features/vault/hooks/health/useCredentialHealth';
import { computeHealthScore, getTierStyle } from '@/features/vault/utils/credentialHealthScore';

interface CompositeHealthDotProps {
  healthResult: HealthResult | null;
  rotationStatus: RotationStatus | null;
}

export function CompositeHealthDot({
  healthResult,
  rotationStatus,
}: CompositeHealthDotProps) {
  const composite = useMemo(
    () => computeHealthScore(healthResult, rotationStatus),
    [healthResult, rotationStatus],
  );
  const style = getTierStyle(composite.tier);

  const staleNote = healthResult?.isStale ? ' (from previous session)' : '';

  return (
    <span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dotColor} ${healthResult?.isStale ? 'opacity-60' : ''}`}
      title={`${style.label} (${composite.score}/100) -- ${composite.reason}${staleNote}`}
    />
  );
}
