import { useState, useMemo, useCallback } from 'react';
import { useVaultStore } from '@/stores/vaultStore';
import { BaseModal } from '@/lib/ui/BaseModal';
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

  const handleHealthcheck = useCallback(
    async (values: Record<string, string>) => {
      setIsHealthchecking(true);
      setHealthcheckResult(null);
      try {
        const result = await useVaultStore
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
    <BaseModal isOpen onClose={onClose} titleId="catalog-credential-title" maxWidthClass="max-w-2xl" panelClassName="max-h-[85vh] overflow-y-auto">
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
    </BaseModal>
  );
}
