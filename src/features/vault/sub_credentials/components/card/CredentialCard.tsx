import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { CredentialCardHeader } from '@/features/vault/sub_credentials/components/card/CredentialCardHeader';
import { CredentialCardDetails } from '@/features/vault/sub_credentials/components/card/CredentialCardDetails';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { useCredentialHealth } from '@/features/vault/shared/hooks/health/useCredentialHealth';
import { useRotationTicker, formatCountdown } from '@/features/vault/shared/hooks/useRotationTicker';
import { useVaultStore } from '@/stores/vaultStore';
import { useTranslation } from '@/i18n/useTranslation';

interface CredentialCardProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  onSelect?: () => void;
  onDelete: (id: string) => void;
}

export function CredentialCard({
  credential,
  connector,
  onSelect,
  onDelete,
}: CredentialCardProps) {
  const { t, tx } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const rotationStatus = useVaultStore((s) => s.rotationStatuses[credential.id] ?? null);
  const storeFetchRotationStatus = useVaultStore((s) => s.fetchRotationStatus);
  const isPendingDelete = useVaultStore((s) => s.pendingDeleteCredentialIds.has(credential.id));

  const { result: healthcheckResult, isHealthchecking, checkStored, checkPreview } = useCredentialHealth(credential.id);

  useRotationTicker();
  const rotationCountdown = formatCountdown(rotationStatus?.next_rotation_at);

  const fetchRotationStatus = useCallback(async () => {
    await storeFetchRotationStatus(credential.id);
  }, [storeFetchRotationStatus, credential.id]);

  useEffect(() => {
    if (!rotationStatus) {
      fetchRotationStatus();
    }
  }, [rotationStatus, fetchRotationStatus]);

  const effectiveHealthcheckResult = useMemo(() =>
    healthcheckResult ?? (
      credential.healthcheck_last_success === null
        ? null
        : {
            success: credential.healthcheck_last_success,
            message: credential.healthcheck_last_message ?? t.vault.credential_card.stored_result,
            isStale: true,
          }
    ), [healthcheckResult, credential.healthcheck_last_success, credential.healthcheck_last_message]);

  const handleToggle = useCallback(() => {
    setExpanded((prev) => !prev);
    onSelect?.();
  }, [onSelect]);

  const health = useMemo(() => ({
    checkStored,
    checkPreview: (serviceType: string, values: Record<string, string>) =>
      checkPreview(serviceType, values),
  }), [checkStored, checkPreview]);

  if (isPendingDelete) {
    return (
      <div
        className="animate-fade-slide-in bg-secondary/25 backdrop-blur-sm border border-red-500/20 rounded-card overflow-hidden pointer-events-none"
      >
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-red-400/70">
          <LoadingSpinner size="sm" />
          {tx(t.vault.credential_card.deleting, { name: credential.name })}
        </div>
      </div>
    );
  }

  return (
    <div
      className="animate-fade-slide-in bg-secondary/25 backdrop-blur-sm border border-primary/15 rounded-card overflow-hidden"
    >
      <CredentialCardHeader
        credential={credential}
        connector={connector}
        effectiveHealthcheckResult={effectiveHealthcheckResult}
        rotationStatus={rotationStatus}
        rotationCountdown={rotationCountdown}
        onSelect={handleToggle}
        onDelete={onDelete}
      />
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          {connector && (
            <div className="px-3 pb-3 border-t border-primary/10">
              <div className="pt-3">
                <CredentialCardDetails
                  credential={credential}
                  connector={connector}
                  effectiveHealthcheckResult={effectiveHealthcheckResult}
                  isHealthchecking={isHealthchecking}
                  health={health}
                  rotationStatus={rotationStatus}
                  rotationCountdown={rotationCountdown}
                  fetchRotationStatus={fetchRotationStatus}
                  onStartEditing={() => {}}
                />
              </div>
            </div>
          )}
          {!connector && (
            <div className="px-3 pb-3 border-t border-primary/10">
              <div className="text-sm text-foreground py-3">
                {t.vault.credential_card.no_connector}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
