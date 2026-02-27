import { useState, useMemo } from 'react';
import { Plug, Server } from 'lucide-react';
import { motion } from 'framer-motion';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
import { McpPrefilledForm } from '@/features/vault/components/credential-types/McpPrefilledForm';
import type { ConnectorDefinition, CredentialTemplateField, ConnectorAuthMethod } from '@/lib/types/types';
import { getAuthMethods } from '@/lib/types/types';
import { getAuthBadgeClasses } from '@/features/vault/utils/authMethodStyles';

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
  isAuthorizingOAuth: boolean;
  oauthCompletedAt: string | null;
  onCreateCredential: (values: Record<string, string>) => void;
  onOAuthConsent: (values: Record<string, string>) => void;
  onCancel: () => void;
  onValuesChanged: (key: string, value: string) => void;
  onMcpComplete?: () => void;
  // Healthcheck props
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
  isAuthorizingOAuth,
  oauthCompletedAt,
  onCreateCredential,
  onOAuthConsent,
  onCancel,
  onValuesChanged,
  onMcpComplete,
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

  // Auth method tabs (PAT vs MCP, etc.)
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

  const hasHealthcheckConfig = selectedConnector.healthcheck_config != null;
  const healthcheckPassed = healthcheckResult?.success === true;

  const requiresHealthcheck = hasHealthcheckConfig && !isGoogleTemplate;
  const saveDisabled = isGoogleTemplate || (requiresHealthcheck && !healthcheckPassed);
  const saveDisabledReason = isGoogleTemplate
    ? 'Use Authorize with Google to create this credential.'
    : requiresHealthcheck && !healthcheckPassed
      ? 'Run a successful connection test before saving.'
      : undefined;

  return (
    <motion.div
      key="form"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-2xl p-6 space-y-4"
    >
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center border"
          style={{
            backgroundColor: `${selectedConnector.color}15`,
            borderColor: `${selectedConnector.color}30`,
          }}
        >
          {selectedConnector.icon_url ? (
            <img src={selectedConnector.icon_url} alt={selectedConnector.label} className="w-5 h-5" />
          ) : (
            <Plug className="w-5 h-5" style={{ color: selectedConnector.color }} />
          )}
        </div>
        <div>
          <h4 className="font-medium text-foreground">New {selectedConnector.label} Credential</h4>
          <p className="text-sm text-muted-foreground/80">
            {activeMethod?.type === 'mcp'
              ? 'Configure MCP server connection'
              : selectedConnector.healthcheck_config?.description || 'Configure credential fields'}
          </p>
        </div>
      </div>

      {/* Auth method tabs — shown when multiple methods available */}
      {authMethods.length > 1 && (
        <div className="flex gap-1 p-1 bg-secondary/15 border border-primary/8 rounded-lg">
          {authMethods.map((method) => (
            <button
              key={method.id}
              onClick={() => handleAuthMethodChange(method)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeAuthMethodId === method.id
                  ? `border ${getAuthBadgeClasses(method)}`
                  : 'text-muted-foreground/80 hover:bg-secondary/40 border border-transparent'
              }`}
            >
              {method.type === 'mcp' && <Server className="w-3 h-3" />}
              {method.label}
            </button>
          ))}
        </div>
      )}

      {/* MCP method — show McpPrefilledForm */}
      {activeMethod?.type === 'mcp' ? (
        <McpPrefilledForm
          connector={selectedConnector}
          authMethod={activeMethod}
          onComplete={onMcpComplete ?? onCancel}
          onCancel={onCancel}
        />
      ) : (
        <>
          {/* Credential name input */}
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1.5">
              Credential Name
            </label>
            <input
              type="text"
              value={credentialName}
              onChange={(e) => onCredentialNameChange(e.target.value)}
              placeholder={`My ${selectedConnector.label} Account`}
              className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground text-sm placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
            />
          </div>

          {/* Auth variant tabs (e.g., Supabase Anon vs Service Role) */}
          {variants && variants.length > 1 && (
            <div className="flex gap-1.5 p-1 bg-secondary/15 border border-primary/8 rounded-lg">
              {variants.map((v) => (
                <button
                  key={v.id}
                  onClick={() => handleVariantChange(v.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    activeVariantId === v.id
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'text-muted-foreground/80 hover:bg-secondary/40 border border-transparent'
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>
          )}

          <CredentialEditForm
            fields={variantFields}
            onSave={onCreateCredential}
            onOAuthConsent={isGoogleTemplate ? onOAuthConsent : undefined}
            oauthConsentLabel={isAuthorizingOAuth ? 'Authorizing with Google...' : 'Authorize with Google'}
            oauthConsentDisabled={isAuthorizingOAuth}
            oauthConsentHint={isGoogleTemplate
              ? 'One click consent: uses app-managed Google OAuth and saves token metadata in background.'
              : undefined}
            oauthConsentSuccessBadge={oauthCompletedAt ? `Google consent completed at ${oauthCompletedAt}` : undefined}
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
    </motion.div>
  );
}
