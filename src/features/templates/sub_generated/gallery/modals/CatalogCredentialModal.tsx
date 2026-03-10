import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { CredentialTemplateForm } from '@/features/vault/sub_forms/CredentialTemplateForm';
import { isGoogleOAuthConnector } from '@/lib/utils/platform/connectors';
import { testCredentialDesignHealthcheck } from '@/api/vault/credentialDesign';
import type { ConnectorDefinition } from '@/lib/types/types';

interface CatalogCredentialModalProps {
  connectorDefinition: ConnectorDefinition;
  onSave: (values: Record<string, string>) => void;
  onClose: () => void;
}

export function CatalogCredentialModal({
  connectorDefinition,
  onSave,
  onClose,
}: CatalogCredentialModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const isGoogleTemplate = isGoogleOAuthConnector(connectorDefinition);

  const effectiveTemplateFields = useMemo(() => {
    const fields = connectorDefinition.fields ?? [];
    if (isGoogleTemplate) {
      return fields.filter(
        (f) => !['client_id', 'client_secret', 'refresh_token', 'scopes'].includes(f.key),
      );
    }
    return fields;
  }, [connectorDefinition.fields, isGoogleTemplate]);

  const [credentialName, setCredentialName] = useState(
    `${connectorDefinition.label} Credential`,
  );
  const [isHealthchecking, setIsHealthchecking] = useState(false);
  const [healthcheckResult, setHealthcheckResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [isAuthorizingOAuth, setIsAuthorizingOAuth] = useState(false);
  const [oauthCompletedAt] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleHealthcheck = useCallback(
    async (values: Record<string, string>) => {
      setIsHealthchecking(true);
      setHealthcheckResult(null);
      try {
        const result = await usePersonaStore
          .getState()
          .healthcheckCredentialPreview(connectorDefinition.name, values);
        setHealthcheckResult(result);
      } catch {
        // intentional: healthcheck error is shown inline via result state
        setHealthcheckResult({ success: false, message: 'Healthcheck failed' });
      } finally {
        setIsHealthchecking(false);
      }
    },
    [connectorDefinition.name],
  );

  const handleDynamicHealthcheck = useCallback(
    async (values: Record<string, string>) => {
      setIsHealthchecking(true);
      setHealthcheckResult(null);
      try {
        const result = await testCredentialDesignHealthcheck(
          `Test connection for ${connectorDefinition.label} connector`,
          {
            name: connectorDefinition.name,
            label: connectorDefinition.label,
            fields: connectorDefinition.fields,
          },
          values,
        );
        setHealthcheckResult({ success: result.success, message: result.message });
      } catch {
        // intentional: healthcheck error is shown inline via result state
        setHealthcheckResult({ success: false, message: 'Connection test failed' });
      } finally {
        setIsHealthchecking(false);
      }
    },
    [connectorDefinition],
  );

  const handleOAuthConsent = useCallback((_values: Record<string, string>) => {
    setIsAuthorizingOAuth(true);
    // OAuth flow would be handled here for Google connectors
  }, []);

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        className="max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto"
      >
        <CredentialTemplateForm
          selectedConnector={connectorDefinition}
          credentialName={credentialName}
          onCredentialNameChange={setCredentialName}
          effectiveTemplateFields={effectiveTemplateFields}
          isGoogleTemplate={isGoogleTemplate}
          isAuthorizingOAuth={isAuthorizingOAuth}
          oauthCompletedAt={oauthCompletedAt}
          onCreateCredential={onSave}
          onOAuthConsent={handleOAuthConsent}
          onCancel={onClose}
          onValuesChanged={() => {
            setHealthcheckResult(null);
          }}
          onHealthcheck={
            connectorDefinition.healthcheck_config ? handleHealthcheck : handleDynamicHealthcheck
          }
          isHealthchecking={isHealthchecking}
          healthcheckResult={healthcheckResult}
        />
      </div>
    </div>
  );
}
