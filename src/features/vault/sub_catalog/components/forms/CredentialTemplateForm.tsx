import { useState, useMemo, useEffect } from 'react';
import { CodebaseProjectPicker } from '@/features/vault/sub_catalog/components/forms/CodebaseProjectPicker';
import { McpPrefilledForm } from '@/features/vault/sub_catalog/components/schemas/McpPrefilledForm';
import { CliConnectionPanel } from '@/features/vault/sub_catalog/components/picker/CliConnectionPanel';
import type { ConnectorDefinition, CredentialTemplateField, ConnectorAuthMethod } from '@/lib/types/types';
import { getAuthMethods } from '@/lib/types/types';
import { SetupGuideSection } from '@/features/vault/sub_credentials/components/forms/SetupGuideSection';
import { TemplateFormHeader } from '@/features/vault/sub_credentials/components/forms/TemplateFormHeader';
import { AuthMethodTabs } from '@/features/vault/sub_credentials/components/forms/AuthMethodTabs';
import { TemplateFormBody } from './TemplateFormBody';
import { useTranslation } from '@/i18n/useTranslation';
import { listCliSpecs, type CliSpecInfo } from '@/api/auth/cliCapture';
import { silentCatch } from '@/lib/silentCatch';

interface AuthVariant {
  id: string;
  label: string;
  fields: string[];
  auth_type_label: string;
}

export interface CredentialTemplateFormProps {
  selectedConnector: ConnectorDefinition;
  credentialName: string;
  onCredentialNameChange: (name: string) => void;
  effectiveTemplateFields: CredentialTemplateField[];
  isGoogleTemplate: boolean;
  isOAuthTemplate?: boolean;
  isAuthorizingOAuth: boolean;
  oauthCompletedAt: string | null;
  oauthValues?: Record<string, string>;
  oauthConsentLabel?: string;
  oauthPollingMessage?: { success: boolean; message: string } | null;
  onCreateCredential: (values: Record<string, string>) => void;
  onOAuthConsent: (values: Record<string, string>) => void;
  onCancel: () => void;
  onBack?: () => void;
  onValuesChanged: (key: string, value: string) => void;
  onMcpComplete?: () => void;
  onAutoSetup?: () => void;
  onDesktopDetect?: () => void;
  onHealthcheck?: (values: Record<string, string>) => void;
  isHealthchecking?: boolean;
  healthcheckResult?: { success: boolean; message: string } | null;
}

export function CredentialTemplateForm({
  selectedConnector,
  credentialName,
  onCredentialNameChange,
  effectiveTemplateFields,
  isGoogleTemplate,
  isOAuthTemplate,
  isAuthorizingOAuth,
  oauthCompletedAt,
  oauthValues,
  oauthConsentLabel,
  oauthPollingMessage,
  onCreateCredential,
  onOAuthConsent,
  onCancel,
  onBack,
  onValuesChanged,
  onMcpComplete,
  onAutoSetup,
  onDesktopDetect,
  onHealthcheck,
  isHealthchecking,
  healthcheckResult,
}: CredentialTemplateFormProps) {
  const { t } = useTranslation();
  const metadata = (selectedConnector.metadata ?? {}) as Record<string, unknown>;
  const variants = useMemo<AuthVariant[] | null>(() => {
    if (!Array.isArray(metadata.auth_variants)) return null;
    return metadata.auth_variants as AuthVariant[];
  }, [metadata.auth_variants]);

  const [activeVariantId, setActiveVariantId] = useState<string | null>(
    variants?.[0]?.id ?? null,
  );

  // CLI spec list: used to hide CLI auth method tabs for connectors without a
  // registered spec (e.g. user advertises CLI support but binary isn't wired).
  const [cliSpecs, setCliSpecs] = useState<CliSpecInfo[] | null>(null);
  useEffect(() => {
    listCliSpecs().then(setCliSpecs).catch((e) => {
      silentCatch('CredentialTemplateForm:listCliSpecs')(e);
      setCliSpecs([]);
    });
  }, []);

  const rawAuthMethods = useMemo(() => getAuthMethods(selectedConnector), [selectedConnector]);
  const authMethods = useMemo(() => {
    if (cliSpecs === null) {
      // Hide CLI tabs until we know which specs are registered.
      return rawAuthMethods.filter((m) => m.type !== 'cli');
    }
    const registered = new Set(cliSpecs.map((s) => s.service_type));
    return rawAuthMethods.filter((m) => m.type !== 'cli' || registered.has(selectedConnector.name));
  }, [rawAuthMethods, cliSpecs, selectedConnector.name]);

  const activeCliSpec = useMemo(
    () => cliSpecs?.find((s) => s.service_type === selectedConnector.name) ?? null,
    [cliSpecs, selectedConnector.name],
  );

  const defaultMethodId = useMemo(
    () => (authMethods.find((m) => m.is_default) ?? authMethods[0])?.id ?? authMethods[0]?.id ?? 'default',
    [authMethods],
  );
  const [activeAuthMethodId, setActiveAuthMethodId] = useState<string>(defaultMethodId);
  const activeMethod = authMethods.find((m) => m.id === activeAuthMethodId) ?? authMethods[0];

  const variantFields = useMemo(() => {
    if (!activeVariantId || !variants) return effectiveTemplateFields;
    const v = variants.find((vr) => vr.id === activeVariantId);
    return v ? effectiveTemplateFields.filter((f) => v.fields.includes(f.key)) : effectiveTemplateFields;
  }, [activeVariantId, variants, effectiveTemplateFields]);

  const handleVariantChange = (variantId: string) => {
    setActiveVariantId(variantId);
    const v = variants?.find((vr) => vr.id === variantId);
    if (v) {
      onCredentialNameChange(`${selectedConnector.label} ${v.auth_type_label}`);
    }
    onValuesChanged('', '');
  };

  const handleAuthMethodChange = (method: ConnectorAuthMethod) => {
    setActiveAuthMethodId(method.id);
    if (method.type === 'mcp') {
      onCredentialNameChange(`${selectedConnector.label} MCP`);
    } else if (method.type === 'cli') {
      onCredentialNameChange(`${selectedConnector.label} CLI`);
    } else {
      const v = variants?.find((vr) => vr.id === activeVariantId);
      onCredentialNameChange(`${selectedConnector.label} ${v?.auth_type_label ?? method.label}`);
    }
  };

  const guide = typeof metadata.setup_guide === 'string' ? metadata.setup_guide : null;
  const isAnyOAuth = !!isGoogleTemplate || !!isOAuthTemplate;
  const oauthDone = isAnyOAuth && !!oauthCompletedAt;
  const requiresHealthcheck = onHealthcheck != null;
  const saveDisabled = isAnyOAuth
    ? !oauthDone || (requiresHealthcheck && !healthcheckResult?.success)
    : requiresHealthcheck && !healthcheckResult?.success;
  const saveDisabledReason = isAnyOAuth && !oauthDone
    ? t.vault.credential_forms.oauth_required
    : requiresHealthcheck && !healthcheckResult?.success ? t.vault.credential_forms.healthcheck_required : undefined;

  return (
    <div key="form"
      className="animate-fade-slide-in w-full bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-6 space-y-4">
      <TemplateFormHeader selectedConnector={selectedConnector} activeMethod={activeMethod}
        onBack={onBack} onAutoSetup={onAutoSetup} onDesktopDetect={onDesktopDetect} />
      {guide && <SetupGuideSection guide={guide} connectorLabel={selectedConnector.label} />}
      <AuthMethodTabs
        authMethods={authMethods}
        activeAuthMethodId={activeAuthMethodId}
        onMethodChange={handleAuthMethodChange}
      />

      {selectedConnector.name === 'codebase' || selectedConnector.name === 'codebases' ? (
        <CodebaseProjectPicker
          onSave={(data) => onCreateCredential(data)}
          onCancel={onCancel}
          credentialName={credentialName}
          onCredentialNameChange={onCredentialNameChange}
          multiSelect={selectedConnector.name === 'codebases'}
        />
      ) : activeMethod?.type === 'mcp' ? (
        <McpPrefilledForm
          connector={selectedConnector}
          authMethod={activeMethod}
          onComplete={onMcpComplete ?? onCancel}
          onCancel={onCancel}
        />
      ) : activeMethod?.type === 'cli' && activeCliSpec ? (
        <CliConnectionPanel
          connector={selectedConnector}
          spec={activeCliSpec}
          credentialName={credentialName}
          onCredentialNameChange={onCredentialNameChange}
          onCreateCredential={onCreateCredential}
          onCancel={onCancel}
        />
      ) : (
        <TemplateFormBody
          selectedConnector={selectedConnector}
          credentialName={credentialName}
          onCredentialNameChange={onCredentialNameChange}
          variantFields={variantFields}
          variants={variants}
          activeVariantId={activeVariantId}
          onVariantChange={handleVariantChange}
          isAnyOAuth={isAnyOAuth}
          isAuthorizingOAuth={isAuthorizingOAuth}
          oauthCompletedAt={oauthCompletedAt}
          oauthValues={oauthValues}
          oauthConsentLabel={oauthConsentLabel}
          oauthPollingMessage={oauthPollingMessage}
          onCreateCredential={onCreateCredential}
          onOAuthConsent={onOAuthConsent}
          onCancel={onCancel}
          onValuesChanged={onValuesChanged}
          saveDisabled={saveDisabled}
          saveDisabledReason={saveDisabledReason}
          onHealthcheck={onHealthcheck}
          isHealthchecking={isHealthchecking}
          healthcheckResult={healthcheckResult}
        />
      )}
    </div>
  );
}
