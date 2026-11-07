import { useMemo } from 'react';
import type { RotationStatus } from '@/api/vault/rotation';
import type { HealthResult } from '@/features/vault/shared/hooks/health/useCredentialHealth';
import { computeHealthScore, getTierStyle } from '@/features/vault/shared/utils/credentialHealthScore';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

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
    <Tooltip content={`${style.label} (${composite.score}/100) -- ${composite.reason}${staleNote}`}><span
      className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dotColor} ${healthResult?.isStale ? 'opacity-60' : ''}`}
    /></Tooltip>
  );
}
