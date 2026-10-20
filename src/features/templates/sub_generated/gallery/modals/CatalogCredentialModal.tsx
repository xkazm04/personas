import { useState, useMemo, useCallback } from 'react';
import { useVaultStore } from '@/stores/vaultStore';
import { BaseModal } from '@/lib/ui/BaseModal';
import { CredentialTemplateForm } from '@/features/vault/sub_catalog/components/forms/CredentialTemplateForm';
import { isGoogleOAuthConnector } from '@/lib/utils/platform/connectors';
import { testCredentialDesignHealthcheck } from '@/api/overview/healthcheckApi';
import type { ConnectorDefinition } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { silentCatch, extractMessage } from '@/lib/silentCatch';

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
  const { t, tx } = useTranslation();
  const isGoogleTemplate = isGoogleOAuthConnector(connectorDefinition);

  // A recognised failure shows its registry wording; anything else shows the
  // step's own localized line. Either way the raw error is reported first.
  const failureMessage = useCallback(
    (err: unknown, context: string, fallback: string) => {
      silentCatch(`CatalogCredentialModal:${context}`)(err);
      const resolved = resolveErrorTranslated(t, extractMessage(err));
      return resolved.category === 'unclassified' ? fallback : resolved.message;
    },
    [t],
  );

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
    tx(t.templates.gallery.cred_default_name, { name: connectorDefinition.label }),
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
      } catch (err) {
        setHealthcheckResult({
          success: false,
          message: failureMessage(err, 'healthcheck', t.templates.gallery.cred_healthcheck_failed),
        });
      } finally {
        setIsHealthchecking(false);
      }
    },
    [connectorDefinition.name, failureMessage, t],
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
      } catch (err) {
        setHealthcheckResult({
          success: false,
          message: failureMessage(err, 'connectionTest', t.templates.gallery.cred_test_failed),
        });
      } finally {
        setIsHealthchecking(false);
      }
    },
    [connectorDefinition, failureMessage, t],
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
