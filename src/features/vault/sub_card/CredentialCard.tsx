import { useCallback, useEffect, useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { CredentialCardHeader } from '@/features/vault/sub_card/CredentialCardHeader';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { useCredentialHealth } from '@/features/vault/hooks/useCredentialHealth';
import { useRotationTicker, formatCountdown } from '@/features/vault/hooks/useRotationTicker';
import type { RotationStatus } from '@/api/rotation';
import { getRotationStatus } from '@/api/rotation';

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

  const { result: healthcheckResult } = useCredentialHealth(credential.id);

  useRotationTicker();
  const rotationCountdown = formatCountdown(rotationStatus?.next_rotation_at);

  const fetchRotationStatus = useCallback(async () => {
    try {
      const status = await getRotationStatus(credential.id);
      setRotationStatus(status);
    } catch {
      // intentional: non-critical — rotation status not yet configured for this credential
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
          }
    ), [healthcheckResult, credential.healthcheck_last_success, credential.healthcheck_last_message]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-secondary/25 backdrop-blur-sm border border-primary/15 rounded-lg overflow-hidden"
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
    </motion.div>
  );
}
