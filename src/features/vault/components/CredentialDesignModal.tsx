import { useState, useEffect } from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCredentialDesign } from '@/hooks/design/useCredentialDesign';
import { useOAuthConsent } from '@/hooks/design/useOAuthConsent';
import { useUniversalOAuth } from '@/hooks/design/useUniversalOAuth';
import { useHealthcheckState } from '@/features/vault/hooks/useHealthcheckState';
import type { CredentialTemplateField } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';
import { extractFirstUrl } from '@/features/vault/components/credential-design/CredentialDesignHelpers';
import { CredentialDesignProvider, type CredentialDesignContextValue } from '@/features/vault/components/credential-design/CredentialDesignContext';
import { IdlePhase } from '@/features/vault/components/credential-design/IdlePhase';
import { AnalyzingPhase } from '@/features/vault/components/credential-design/AnalyzingPhase';
import { PreviewPhase } from '@/features/vault/components/credential-design/PreviewPhase';
import { DonePhase } from '@/features/vault/components/credential-design/DonePhase';
import { ErrorPhase } from '@/features/vault/components/credential-design/ErrorPhase';

interface CredentialDesignModalProps {
  open: boolean;
  embedded?: boolean;
  initialInstruction?: string;
  onClose: () => void;
  onComplete: () => void;
}

export function CredentialDesignModal({ open, embedded = false, initialInstruction, onClose, onComplete }: CredentialDesignModalProps) {
  const { phase, outputLines, result, error, savedCredentialId, start, cancel, save, reset, loadTemplate } = useCredentialDesign();
  const oauth = useOAuthConsent();
  const universalOAuth = useUniversalOAuth();
  const healthcheck = useHealthcheckState();
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const setCredentialView = usePersonaStore((s) => s.setCredentialView);
  const [instruction, setInstruction] = useState('');
  const [credentialName, setCredentialName] = useState('');
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);
  const [negotiatorValues, setNegotiatorValues] = useState<Record<string, string>>({});

  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);

  // Sync OAuth message into healthcheckResult
  useEffect(() => {
    if (oauth.message) {
      healthcheck.setHealthcheckResult(oauth.message);
    }
  }, [oauth.message, healthcheck.setHealthcheckResult]);

  useEffect(() => {
    if (universalOAuth.message) {
      healthcheck.setHealthcheckResult(universalOAuth.message);
    }
  }, [universalOAuth.message, healthcheck.setHealthcheckResult]);

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      reset();
      oauth.reset();
      universalOAuth.reset();
      healthcheck.reset();
      setInstruction('');
      setCredentialName('');
      setShowTemplates(false);
      setTemplateSearch('');
      setExpandedTemplateId(null);
      setNegotiatorValues({});

      fetchConnectorDefinitions();

      // Auto-start design if pre-filled instruction provided
      if (initialInstruction?.trim()) {
        setInstruction(initialInstruction.trim());
        start(initialInstruction.trim());
      }
    }
  }, [open, reset, oauth.reset, universalOAuth.reset, healthcheck.reset, fetchConnectorDefinitions]);

  useEffect(() => {
    if (phase === 'preview' && result) {
      setCredentialName((prev) => prev || `${result.connector.label} Credential`);
    }
  }, [phase, result]);

  const handleStart = () => {
    if (!instruction.trim()) return;
    start(instruction.trim());
  };

  const handleSave = (values: Record<string, string>) => {
    if (isGoogleOAuthFlow && values.refresh_token?.trim()) {
      const name = credentialName.trim() || `${result?.connector.label} Credential`;
      save(name, values, healthcheck.testedHealthcheckConfig);
      return;
    }

    if (!healthcheck.healthcheckResult?.success || !healthcheck.testedHealthcheckConfig) {
      healthcheck.setHealthcheckResult({
        success: false,
        message: 'Run Test Connection and get a successful result before saving.',
      });
      return;
    }

    const name = credentialName.trim() || `${result?.connector.label} Credential`;
    save(name, values, healthcheck.testedHealthcheckConfig);
  };

  const handleHealthcheck = async (values: Record<string, string>) => {
    if (!result) return;
    await healthcheck.runHealthcheck(
      instruction.trim() || result.connector.label,
      result.connector as unknown as Record<string, unknown>,
      values,
    );
  };

  const handleCredentialValuesChanged = (key: string, value: string) => {
    healthcheck.handleValuesChanged(key, value);
    if (oauth.completedAt) {
      oauth.reset();
    }
  };

  const handleOAuthConsent = (values: Record<string, string>) => {
    if (universalOAuthProvider) {
      // Universal OAuth flow
      const clientId = values.client_id?.trim();
      const clientSecret = values.client_secret?.trim();
      if (!clientId) return;
      universalOAuth.startConsent({
        providerId: universalOAuthProvider,
        clientId,
        clientSecret: clientSecret || undefined,
        scopes: values.scopes?.trim() ? values.scopes.trim().split(/\s+/) : undefined,
      });
    } else {
      // Google OAuth flow
      oauth.startConsent(result?.connector.name || 'google', values);
    }
  };

  const handleClose = () => {
    if (phase === 'analyzing') {
      cancel();
    }
    if (phase === 'done') {
      onComplete();
    }
    onClose();
  };

  const handleViewCredential = () => {
    onComplete();
    onClose();
    setSidebarSection('credentials');
    setCredentialView('credentials');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && phase === 'idle') {
      e.preventDefault();
      handleStart();
    }
  };

  const handleResetPreview = () => {
    reset();
    healthcheck.reset();
  };

  const handleRefine = () => {
    const preserved = instruction;
    reset();
    setInstruction(preserved);
    setCredentialName('');
    healthcheck.reset();
    setNegotiatorValues({});
  };

  if (!open) return null;

  // Map result fields to CredentialTemplateField format
  const fields: CredentialTemplateField[] = result?.connector.fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type as CredentialTemplateField['type'],
    required: f.required,
    placeholder: f.placeholder,
    helpText: f.helpText,
  })) ?? [];

  const firstSetupUrl = extractFirstUrl(result?.setup_instructions);
  const requiredCount = fields.filter((f) => f.required).length;
  const optionalCount = Math.max(0, fields.length - requiredCount);

  const fieldKeys = new Set(fields.map((f) => f.key));
  const isGoogleOAuthFlow = Boolean(
    result
    && (result.connector.oauth_type === 'google'
      || (fieldKeys.has('client_id') && fieldKeys.has('client_secret') && fieldKeys.has('refresh_token'))),
  );

  // Detect non-Google OAuth providers (universal OAuth)
  const universalOAuthProvider = result?.connector.oauth_type
    && result.connector.oauth_type !== 'google'
    ? result.connector.oauth_type
    : null;

  const effectiveFields = isGoogleOAuthFlow
    ? fields.filter((f) => !['client_id', 'client_secret', 'refresh_token', 'scopes'].includes(f.key))
    : universalOAuthProvider
      ? fields.filter((f) => !['access_token', 'refresh_token', 'scopes', 'oauth_scope'].includes(f.key))
      : fields;

  const canSaveCredential = isGoogleOAuthFlow
    ? Boolean(oauth.initialValues.refresh_token)
    : universalOAuthProvider
      ? Boolean(universalOAuth.initialValues.access_token)
      : (healthcheck.healthcheckResult?.success === true && healthcheck.testedHealthcheckConfig !== null);

  const handleNegotiatorValues = (values: Record<string, string>) => {
    setNegotiatorValues(values);
    healthcheck.reset();
  };

  const designContext: CredentialDesignContextValue | null = result
    ? {
      result,
      fields,
      effectiveFields,
      requiredCount,
      optionalCount,
      firstSetupUrl,
      credentialName,
      onCredentialNameChange: setCredentialName,
      isGoogleOAuthFlow,
      universalOAuthProvider,
      oauthInitialValues: { ...oauth.initialValues, ...universalOAuth.initialValues, ...negotiatorValues },
      isAuthorizingOAuth: oauth.isAuthorizing || universalOAuth.isAuthorizing,
      oauthConsentCompletedAt: oauth.completedAt || universalOAuth.completedAt,
      isHealthchecking: healthcheck.isHealthchecking,
      healthcheckResult: healthcheck.healthcheckResult,
      canSaveCredential,
      lastSuccessfulTestAt: healthcheck.lastSuccessfulTestAt,
      onSave: handleSave,
      onOAuthConsent: handleOAuthConsent,
      onHealthcheck: handleHealthcheck,
      onValuesChanged: handleCredentialValuesChanged,
      onReset: handleResetPreview,
      onRefine: handleRefine,
      onNegotiatorValues: handleNegotiatorValues,
    }
    : null;

  const templateConnectors = connectorDefinitions.filter((conn) => {
    const metadata = conn.metadata as Record<string, unknown> | null;
    if (!metadata) return false;
    if (metadata.template_enabled !== true) return false;

    const q = templateSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      conn.label.toLowerCase().includes(q)
      || conn.name.toLowerCase().includes(q)
      || conn.category.toLowerCase().includes(q)
    );
  });

  const applyTemplate = (connectorName: string) => {
    const template = connectorDefinitions.find((c) => c.name === connectorName);
    if (!template) return;

    const metadata = (template.metadata ?? {}) as Record<string, unknown>;
    const setupInstructions = typeof metadata.setup_instructions === 'string'
      ? metadata.setup_instructions
      : '';
    const summary = typeof metadata.summary === 'string'
      ? metadata.summary
      : `${template.label} connector`;

    loadTemplate({
      match_existing: template.name,
      connector: {
        name: template.name,
        label: template.label,
        category: template.category,
        color: template.color,
        fields: template.fields.map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required ?? false,
          placeholder: f.placeholder,
        })),
        healthcheck_config: template.healthcheck_config,
        services: template.services,
        events: template.events,
      },
      setup_instructions: setupInstructions,
      summary,
    });

    setInstruction(`${template.label} credential`);
    healthcheck.reset();
    setShowTemplates(false);
  };

  return (
    <div className={embedded ? "relative" : "fixed inset-0 z-50 flex items-center justify-center"}>
      {/* Backdrop */}
      {!embedded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
        />
      )}

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className={`relative w-full max-w-3xl ${embedded ? 'max-h-[80vh]' : 'max-h-[min(90vh,960px)]'} overflow-y-auto bg-background border border-primary/15 rounded-2xl ${embedded ? '' : 'shadow-2xl'}`}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-background/95 backdrop-blur-sm border-b border-primary/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Design Credential</h2>
              <p className="text-sm text-muted-foreground/90">
                {phase === 'idle' && 'Describe the service to connect'}
                {phase === 'analyzing' && 'Analyzing your request...'}
                {phase === 'preview' && 'Review and save'}
                {phase === 'saving' && 'Saving...'}
                {phase === 'done' && 'Credential created'}
                {phase === 'error' && 'Something went wrong'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-secondary/60 text-muted-foreground/90 hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          <AnimatePresence mode="wait">
            {phase === 'idle' && (
              <IdlePhase
                instruction={instruction}
                onInstructionChange={setInstruction}
                onStart={handleStart}
                onKeyDown={handleKeyDown}
                showTemplates={showTemplates}
                onToggleTemplates={() => setShowTemplates((prev) => !prev)}
                templateSearch={templateSearch}
                onTemplateSearchChange={setTemplateSearch}
                templateConnectors={templateConnectors}
                expandedTemplateId={expandedTemplateId}
                onExpandTemplate={setExpandedTemplateId}
                onApplyTemplate={applyTemplate}
              />
            )}

            {phase === 'analyzing' && (
              <AnalyzingPhase outputLines={outputLines} onCancel={cancel} />
            )}

            {phase === 'preview' && result && (
              <CredentialDesignProvider value={designContext!}>
                <PreviewPhase />
              </CredentialDesignProvider>
            )}

            {phase === 'saving' && (
              <motion.div
                key="saving"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-12 gap-3"
              >
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground/90">Saving credential...</p>
              </motion.div>
            )}

            {phase === 'done' && (
              <DonePhase
                connectorLabel={result?.connector.label}
                onClose={handleClose}
                onViewCredential={savedCredentialId ? handleViewCredential : undefined}
              />
            )}

            {phase === 'error' && (
              <ErrorPhase
                error={error}
                instruction={instruction}
                onRetry={() => {
                  // Go back to idle but KEEP the instruction text
                  const preserved = instruction;
                  reset();
                  setInstruction(preserved);
                }}
                onStartOver={() => {
                  reset();
                  setInstruction('');
                }}
              />
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
