import type { RotationStatus } from '@/api/vault/rotation';
import { RotationActivePolicy } from './RotationActivePolicy';
import { RotationNewPolicy } from './RotationNewPolicy';

interface RotationPolicyControlsProps {
  credentialId: string;
  rotationStatus: RotationStatus;
  rotationCountdown: string | null;
  isOAuth?: boolean;
  onRefresh: () => Promise<void>;
  onHealthcheck: (id: string) => void;
  onError: (message: string | null) => void;
}

export function RotationPolicyControls({
  credentialId,
  rotationStatus,
  rotationCountdown,
  isOAuth,
  onRefresh,
  onHealthcheck,
  onError,
}: RotationPolicyControlsProps) {
  if (rotationStatus.has_policy) {
    return (
      <RotationActivePolicy
        credentialId={credentialId}
        rotationStatus={rotationStatus}
        rotationCountdown={rotationCountdown}
        isOAuth={isOAuth}
        onRefresh={onRefresh}
        onHealthcheck={onHealthcheck}
        onError={onError}
      />
    );
  }

  return (
    <RotationNewPolicy
      credentialId={credentialId}
      initialDays={rotationStatus.rotation_interval_days ?? (isOAuth ? 1 : 90)}
      isOAuth={isOAuth}
      onRefresh={onRefresh}
      onError={onError}
    />
  );
}
