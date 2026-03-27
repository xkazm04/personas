import { useState, useMemo } from 'react';
import { CredentialEditForm } from '@/features/vault/sub_forms/CredentialEditForm';
import { CodebaseProjectPicker } from '@/features/vault/sub_forms/CodebaseProjectPicker';
import { McpPrefilledForm } from '@/features/vault/sub_schemas/McpPrefilledForm';
import { Button } from '@/features/shared/components/buttons';
import type { ConnectorDefinition, CredentialTemplateField, ConnectorAuthMethod } from '@/lib/types/types';
import { getAuthMethods } from '@/lib/types/types';
import { SetupGuideSection } from './SetupGuideSection';
import { TemplateFormHeader } from './TemplateFormHeader';
import { AuthMethodTabs } from './AuthMethodTabs';

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
  const metadata = (selectedConnector.metadata ?? {}) as Record<string, unknown>;
  const variants = useMemo<AuthVariant[] | null>(() => {
    if (!Array.isArray(metadata.auth_variants)) return null;
    return metadata.auth_variants as AuthVariant[];
  }, [metadata.auth_variants]);

  const [activeVariantId, setActiveVariantId] = useState<string | null>(
    variants?.[0]?.id ?? null,
  );

  const authMethods = useMemo(() => getAuthMethods(selectedConnector), [selectedConnector]);
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
    } else {
      const v = variants?.find((vr) => vr.id === activeVariantId);
      onCredentialNameChange(`${selectedConnector.label} ${v?.auth_type_label ?? method.label}`);
    }
  };

  const guide = typeof metadata.setup_guide === 'string' ? metadata.setup_guide : null;
  const isAnyOAuth = isGoogleTemplate || isOAuthTemplate;
  const oauthDone = isAnyOAuth && !!oauthCompletedAt;
  const requiresHealthcheck = onHealthcheck != null;
  const saveDisabled = isAnyOAuth
    ? !oauthDone || (requiresHealthcheck && !healthcheckResult?.success)
    : requiresHealthcheck && !healthcheckResult?.success;
  const saveDisabledReason = isAnyOAuth && !oauthDone
    ? 'Use the authorize button below to connect this credential.'
    : requiresHealthcheck && !healthcheckResult?.success ? 'Run a successful connection test before saving.' : undefined;

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
      ) : (
        <>
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1.5">
              Credential Name
            </label>
            <input
              type="text"
              value={credentialName}
              onChange={(e) => onCredentialNameChange(e.target.value)}
              placeholder={`Label this credential — e.g. My ${selectedConnector.label} Account, Production ${selectedConnector.label}`}
              className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground text-sm placeholder-muted-foreground/30 focus-ring focus-visible:border-primary/40 transition-all"
            />
          </div>

          {variants && variants.length > 1 && (
            <div className="flex gap-1.5 p-1 bg-secondary/15 border border-primary/8 rounded-lg">
              {variants.map((v) => (
                <Button
                  key={v.id}
                  variant="ghost"
                  size="sm"
                  onClick={() => handleVariantChange(v.id)}
                  className={activeVariantId === v.id
                    ? 'bg-primary/10 text-primary border border-primary/20'
                    : 'text-muted-foreground/80 hover:bg-secondary/40 border border-transparent'}
                >
                  {v.label}
                </Button>
              ))}
            </div>
          )}

          <CredentialEditForm
            fields={variantFields}
            initialValues={oauthValues}
            onSave={onCreateCredential}
            onOAuthConsent={isAnyOAuth ? onOAuthConsent : undefined}
            oauthConsentLabel={isAuthorizingOAuth
              ? `Authorizing with ${selectedConnector.label}...`
              : (oauthConsentLabel ?? `Authorize with ${selectedConnector.label}`)}
            oauthConsentDisabled={isAuthorizingOAuth}
            isAuthorizingOAuth={isAuthorizingOAuth}
            oauthPollingMessage={oauthPollingMessage}
            oauthConsentHint={isAnyOAuth
              ? `Opens ${selectedConnector.label} in your browser. Grant access, then return here.`
              : undefined}
            oauthConsentSuccessBadge={oauthCompletedAt ? `${selectedConnector.label} connected at ${oauthCompletedAt}` : undefined}
            saveDisabled={saveDisabled}
            saveDisabledReason={saveDisabledReason}
            onHealthcheck={onHealthcheck}
            isHealthchecking={isHealthchecking}
            healthcheckResult={healthcheckResult}
            onValuesChanged={onValuesChanged}
            onCancel={onCancel}
          />
        </>
      )}
    </div>
  );
}
