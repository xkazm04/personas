import { useState, useMemo } from 'react';
import { Plug, Server, Bot, ArrowLeft, ChevronDown, ChevronRight } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { motion, AnimatePresence } from 'framer-motion';
import { CredentialEditForm } from '@/features/vault/sub_forms/CredentialEditForm';
import { McpPrefilledForm } from '@/features/vault/sub_schemas/McpPrefilledForm';
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
  onBack?: () => void;
  onValuesChanged: (key: string, value: string) => void;
  onMcpComplete?: () => void;
  onAutoSetup?: () => void;
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
  onBack,
  onValuesChanged,
  onMcpComplete,
  onAutoSetup,
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

  const guide = typeof metadata.setup_guide === 'string' ? metadata.setup_guide : null;

  const healthcheckPassed = healthcheckResult?.success === true;

  const requiresHealthcheck = onHealthcheck != null && !isGoogleTemplate;
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
      className="w-full bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-2xl p-6 space-y-4"
    >
      <div className="flex items-center gap-3 mb-4">
        {onBack && (
          <button
            onClick={onBack}
            className="p-2 -ml-2 rounded-lg hover:bg-secondary/50 transition-colors"
            title="Back to catalog"
          >
            <ArrowLeft className="w-4 h-4 text-muted-foreground/70" />
          </button>
        )}
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center border"
          style={{
            backgroundColor: `${selectedConnector.color}15`,
            borderColor: `${selectedConnector.color}30`,
          }}
        >
          {selectedConnector.icon_url ? (
            <ThemedConnectorIcon url={selectedConnector.icon_url} label={selectedConnector.label} color={selectedConnector.color} size="w-5 h-5" />
          ) : (
            <Plug className="w-5 h-5" style={{ color: selectedConnector.color }} />
          )}
        </div>
        <div className="flex-1">
          <h4 className="font-medium text-foreground">New {selectedConnector.label} Credential</h4>
          <p className="text-sm text-muted-foreground/80">
            {activeMethod?.type === 'mcp'
              ? 'Configure MCP server connection'
              : selectedConnector.healthcheck_config?.description || 'Configure credential fields'}
          </p>
        </div>
        {onAutoSetup && activeMethod?.type !== 'mcp' && (
          <button
            onClick={onAutoSetup}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-cyan-500/20 bg-cyan-500/8 hover:bg-cyan-500/15 text-cyan-300 text-sm font-medium transition-colors"
          >
            <Bot className="w-3.5 h-3.5" />
            Auto Add
          </button>
        )}
      </div>

      {/* Setup guide — collapsible */}
      {guide && <SetupGuideSection guide={guide} connectorLabel={selectedConnector.label} />}

      {/* Auth method tabs — shown when multiple methods available */}
      {authMethods.length > 1 && (
        <div className="flex gap-1 p-1 bg-secondary/15 border border-primary/8 rounded-lg">
          {authMethods.map((method) => (
            <button
              key={method.id}
              onClick={() => handleAuthMethodChange(method)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
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
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
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

function SetupGuideSection({ guide, connectorLabel }: { guide: string; connectorLabel: string }) {
  const [open, setOpen] = useState(false);
  const steps = guide.split('\n').filter(Boolean);

  return (
    <div className="border border-primary/10 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-secondary/30 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/60" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/60" />
        )}
        <span className="text-sm font-medium text-muted-foreground/70">
          How to get {connectorLabel} credentials
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3.5 pb-3 space-y-2">
              {steps.map((line, i) => {
                const stripped = line.replace(/^\d+\.\s*/, '');
                return (
                  <div key={i} className="flex gap-2.5">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 border border-primary/15 flex items-center justify-center text-sm font-bold text-primary/70">
                      {i + 1}
                    </span>
                    <p className="text-sm text-foreground/75 pt-0.5 leading-relaxed">{stripped}</p>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
