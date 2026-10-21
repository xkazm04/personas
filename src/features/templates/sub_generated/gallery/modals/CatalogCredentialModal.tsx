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
import { useGoogleOAuth } from '@/features/vault/shared/hooks/useGoogleOAuth';
import { OAUTH_FIELD } from '@/features/vault/sub_catalog/components/design/CredentialDesignHelpers';

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
  // Same consent flow the vault playground runs. Completion leaves a one-time
  // session ref in the hook; it rides into onSave as `oauth_session_ref`, which
  // createCredential splits out and the backend redeems (no token crosses IPC).
  const googleOAuth = useGoogleOAuth({
    onSuccess: () => setHealthcheckResult(null),
    onError: (message) => setHealthcheckResult({ success: false, message }),
  });

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

  const handleOAuthConsent = useCallback((values: Record<string, string>) => {
    const extraScopes = values.scopes?.trim() ? values.scopes.trim().split(/\s+/) : undefined;
    setHealthcheckResult(null);
    googleOAuth.startConsent(connectorDefinition.name, extraScopes);
  }, [connectorDefinition.name, googleOAuth]);

  const handleSave = useCallback((values: Record<string, string>) => {
    const sessionRef = googleOAuth.getValues()[OAUTH_FIELD.SESSION_REF];
    onSave(isGoogleTemplate && sessionRef ? { ...values, [OAUTH_FIELD.SESSION_REF]: sessionRef } : values);
  }, [googleOAuth, isGoogleTemplate, onSave]);

  return (
    <BaseModal isOpen onClose={onClose} titleId="catalog-credential-title" maxWidthClass="max-w-2xl" panelClassName="max-h-[85vh] overflow-y-auto">
        <CredentialTemplateForm
          selectedConnector={connectorDefinition}
          credentialName={credentialName}
          onCredentialNameChange={setCredentialName}
          effectiveTemplateFields={effectiveTemplateFields}
          isGoogleTemplate={isGoogleTemplate}
          isAuthorizingOAuth={googleOAuth.isAuthorizing}
          oauthCompletedAt={googleOAuth.completedAt}
          oauthValues={googleOAuth.getValues()}
          oauthPollingMessage={googleOAuth.message}
          onCreateCredential={handleSave}
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
