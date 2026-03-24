import { useCallback, useEffect, useState, useMemo } from 'react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { CredentialCardHeader } from '@/features/vault/sub_card/CredentialCardHeader';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { useCredentialHealth } from '@/features/vault/hooks/health/useCredentialHealth';
import { useRotationTicker, formatCountdown } from '@/features/vault/hooks/useRotationTicker';
import type { RotationStatus } from '@/api/vault/rotation';
import { getRotationStatus } from '@/api/vault/rotation';
import { useVaultStore } from '@/stores/vaultStore';

interface CredentialCardProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  onSelect: () => void;
  onDelete: (id: string) => void;
}

export function CredentialCard({
  credential,
  connector,
  onSelect,
  onDelete,
}: CredentialCardProps) {
  const [rotationStatus, setRotationStatus] = useState<RotationStatus | null>(null);
  const isPendingDelete = useVaultStore((s) => s.pendingDeleteCredentialIds.has(credential.id));

  const { result: healthcheckResult } = useCredentialHealth(credential.id);

  useRotationTicker();
  const rotationCountdown = formatCountdown(rotationStatus?.next_rotation_at);

  const fetchRotationStatus = useCallback(async () => {
    try {
      const status = await getRotationStatus(credential.id);
      setRotationStatus(status);
    } catch {
      // intentional: non-critical -- rotation status not yet configured for this credential
    }
  }, [credential.id]);

  useEffect(() => {
    fetchRotationStatus();
  }, [fetchRotationStatus]);

  const effectiveHealthcheckResult = useMemo(() =>
    healthcheckResult ?? (
      credential.healthcheck_last_success === null
        ? null
        : {
            success: credential.healthcheck_last_success,
            message: credential.healthcheck_last_message ?? 'Stored connection test result',
            isStale: true,
          }
    ), [healthcheckResult, credential.healthcheck_last_success, credential.healthcheck_last_message]);

  if (isPendingDelete) {
    return (
      <div
        className="animate-fade-slide-in bg-secondary/25 backdrop-blur-sm border border-red-500/20 rounded-lg overflow-hidden pointer-events-none"
      >
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-red-400/70">
          <LoadingSpinner size="sm" />
          Deleting {credential.name}...
        </div>
      </div>
    );
  }

  return (
    <div
      className="animate-fade-slide-in bg-secondary/25 backdrop-blur-sm border border-primary/15 rounded-lg overflow-hidden"
    >
      <CredentialCardHeader
        credential={credential}
        connector={connector}
        effectiveHealthcheckResult={effectiveHealthcheckResult}
        rotationStatus={rotationStatus}
        rotationCountdown={rotationCountdown}
        onSelect={onSelect}
        onDelete={onDelete}
      />
    </div>
  );
}
