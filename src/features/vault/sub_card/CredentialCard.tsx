import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CredentialCardHeader } from '@/features/vault/sub_card/CredentialCardHeader';
import { CredentialCardBody } from '@/features/vault/sub_card/CredentialCardBody';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { isGoogleOAuthConnector } from '@/lib/utils/connectors';
import { useGoogleOAuth } from '@/features/vault/hooks/useGoogleOAuth';
import { useCredentialHealth } from '@/features/vault/hooks/useCredentialHealth';
import { useRotationTicker, formatCountdown } from '@/features/vault/hooks/useRotationTicker';
import type { RotationStatus } from '@/api/rotation';
import { getRotationStatus } from '@/api/rotation';

interface CredentialCardProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDelete: (id: string) => void;
}

export function CredentialCard({
  credential,
  connector,
  isExpanded,
  onToggleExpand,
  onDelete,
}: CredentialCardProps) {
  const [editError, setEditError] = useState<string | null>(null);
  const [rotationStatus, setRotationStatus] = useState<RotationStatus | null>(null);

  const health = useCredentialHealth(credential.id);
  const { result: healthcheckResult, isHealthchecking } = health;

  // Shared countdown ticker -- one setInterval for all visible cards
  useRotationTicker();
  const rotationCountdown = formatCountdown(rotationStatus?.next_rotation_at);

  const googleOAuth = useGoogleOAuth({
    onSuccess: () => setEditError(null),
    onError: (msg) => setEditError(msg),
  });

  const fetchRotationStatus = useCallback(async () => {
    try {
      const status = await getRotationStatus(credential.id);
      setRotationStatus(status);
    } catch {
      // No rotation data yet -- that's fine
    }
  }, [credential.id]);

  // Fetch rotation status on mount (for header badge) and on expand
  useEffect(() => {
    fetchRotationStatus();
  }, [fetchRotationStatus]);

  const isGoogleOAuthFlow = connector
    ? isGoogleOAuthConnector(connector, credential.service_type)
    : false;

  const effectiveHealthcheckResult = healthcheckResult ?? (
    credential.healthcheck_last_success === null
      ? null
      : {
          success: credential.healthcheck_last_success,
          message: credential.healthcheck_last_message ?? 'Stored connection test result',
        }
  );

  const handleToggle = () => {
    onToggleExpand();
  };

  const handleOAuthConsent = (values: Record<string, string>) => {
    const extraScopes = values.scopes?.trim()
      ? values.scopes.trim().split(/\s+/)
      : undefined;
    setEditError(null);
    googleOAuth.startConsent(connector?.name || credential.service_type, extraScopes);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-secondary/25 backdrop-blur-sm border border-primary/15 rounded-lg overflow-hidden"
    >
      <CredentialCardHeader
        credential={credential}
        connector={connector}
        isExpanded={isExpanded}
        effectiveHealthcheckResult={effectiveHealthcheckResult}
        rotationStatus={rotationStatus}
        rotationCountdown={rotationCountdown}
        onToggle={handleToggle}
        onDelete={onDelete}
      />

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <CredentialCardBody
              credential={credential}
              connector={connector}
              isGoogleOAuthFlow={isGoogleOAuthFlow}
              googleOAuth={googleOAuth}
              effectiveHealthcheckResult={effectiveHealthcheckResult}
              isHealthchecking={isHealthchecking}
              health={health}
              rotationStatus={rotationStatus}
              rotationCountdown={rotationCountdown}
              fetchRotationStatus={fetchRotationStatus}
              editError={editError}
              setEditError={setEditError}
              onOAuthConsent={handleOAuthConsent}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
