import { useState, useEffect } from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCredentialDesign } from '@/hooks/design/useCredentialDesign';
import type { CredentialTemplateField } from '@/lib/types/types';
import { testCredentialDesignHealthcheck, startGoogleCredentialOAuth, getGoogleCredentialOAuthStatus, openExternalUrl } from '@/api/tauriApi';
import { usePersonaStore } from '@/stores/personaStore';
import { normalizeHealthcheckConfig, resolveTemplate, extractFirstUrl } from '@/features/vault/components/credential-design/CredentialDesignHelpers';
import { IdlePhase } from '@/features/vault/components/credential-design/IdlePhase';
import { AnalyzingPhase } from '@/features/vault/components/credential-design/AnalyzingPhase';
import { PreviewPhase } from '@/features/vault/components/credential-design/PreviewPhase';
import { DonePhase } from '@/features/vault/components/credential-design/DonePhase';
import { ErrorPhase } from '@/features/vault/components/credential-design/ErrorPhase';

interface CredentialDesignModalProps {
  open: boolean;
  embedded?: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export function CredentialDesignModal({ open, embedded = false, onClose, onComplete }: CredentialDesignModalProps) {
  const { phase, outputLines, result, error, start, cancel, save, reset, loadTemplate } = useCredentialDesign();
  const [instruction, setInstruction] = useState('');
  const [credentialName, setCredentialName] = useState('');
  const [isHealthchecking, setIsHealthchecking] = useState(false);
  const [healthcheckResult, setHealthcheckResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testedHealthcheckConfig, setTestedHealthcheckConfig] = useState<Record<string, unknown> | null>(null);
  const [testedValues, setTestedValues] = useState<Record<string, string> | null>(null);
  const [lastSuccessfulTestAt, setLastSuccessfulTestAt] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);
  const [oauthInitialValues, setOauthInitialValues] = useState<Record<string, string>>({});
  const [oauthSessionId, setOauthSessionId] = useState<string | null>(null);
  const [isAuthorizingOAuth, setIsAuthorizingOAuth] = useState(false);
  const [oauthConsentCompletedAt, setOauthConsentCompletedAt] = useState<string | null>(null);
  const [oauthScopeFromConsent, setOauthScopeFromConsent] = useState<string | null>(null);

  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      reset();
      setInstruction('');
      setCredentialName('');
      setIsHealthchecking(false);
      setHealthcheckResult(null);
      setTestedHealthcheckConfig(null);
      setLastSuccessfulTestAt(null);
      setShowTemplates(false);
      setTemplateSearch('');
      setExpandedTemplateId(null);
      setOauthInitialValues({});
      setOauthSessionId(null);
      setIsAuthorizingOAuth(false);
      setOauthConsentCompletedAt(null);
      setOauthScopeFromConsent(null);

      fetchConnectorDefinitions();
    }
  }, [open, reset, fetchConnectorDefinitions]);

  useEffect(() => {
    if (phase === 'preview' && result) {
      setCredentialName((prev) => prev || `${result.connector.label} Credential`);
    }
  }, [phase, result]);

  useEffect(() => {
    if (!oauthSessionId) return;

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const status = await getGoogleCredentialOAuthStatus(oauthSessionId);
        if (cancelled) return;

        if (status.status === 'pending') {
          timer = window.setTimeout(poll, 1500);
          return;
        }

        setOauthSessionId(null);
        setIsAuthorizingOAuth(false);

        if (status.status === 'success' && status.refresh_token) {
          const nowIso = new Date().toISOString();
          const effectiveScope = status.scope ?? oauthScopeFromConsent ?? [
            'https://www.googleapis.com/auth/gmail.modify',
            'https://www.googleapis.com/auth/calendar.events',
            'https://www.googleapis.com/auth/drive.file',
            'openid',
            'https://www.googleapis.com/auth/userinfo.email',
          ].join(' ');

          setOauthInitialValues((prev) => ({
            ...prev,
            refresh_token: status.refresh_token!,
            scopes: effectiveScope,
            oauth_scope: effectiveScope,
            oauth_completed_at: nowIso,
            oauth_client_mode: 'app_managed',
          }));
          setOauthConsentCompletedAt(new Date().toLocaleTimeString());
          setHealthcheckResult({
            success: true,
            message: 'Google authorization completed. Refresh token was auto-filled.',
          });
          return;
        }

        setHealthcheckResult({
          success: false,
          message: status.error || 'Google authorization failed. Please try again.',
        });
      } catch (err) {
        if (cancelled) return;
        setOauthSessionId(null);
        setIsAuthorizingOAuth(false);
        setHealthcheckResult({
          success: false,
          message: err instanceof Error ? err.message : 'Failed to check OAuth status.',
        });
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [oauthSessionId, oauthScopeFromConsent]);

  const handleStart = () => {
    if (!instruction.trim()) return;
    start(instruction.trim());
  };

  const handleSave = (values: Record<string, string>) => {
    if (isGoogleOAuthFlow && values.refresh_token?.trim()) {
      const name = credentialName.trim() || `${result?.connector.label} Credential`;
      save(name, values, testedHealthcheckConfig);
      return;
    }

    if (!healthcheckResult?.success || !testedHealthcheckConfig) {
      setHealthcheckResult({
        success: false,
        message: 'Run Test Connection and get a successful result before saving.',
      });
      return;
    }

    const name = credentialName.trim() || `${result?.connector.label} Credential`;
    save(name, values, testedHealthcheckConfig);
  };

  const handleHealthcheck = async (values: Record<string, string>) => {
    if (!result) return;

    setIsHealthchecking(true);
    setHealthcheckResult(null);
    setTestedHealthcheckConfig(null);
    setTestedValues({ ...values });

    try {
      const response = await testCredentialDesignHealthcheck(
        instruction.trim() || result.connector.label,
        result.connector as unknown as Record<string, unknown>,
        values,
      );

      setHealthcheckResult({
        success: response.success,
        message: response.message,
      });

      if (response.healthcheck_config) {
        const skip = response.healthcheck_config.skip === true;
        if (!skip) {
          setTestedHealthcheckConfig(response.healthcheck_config);
          if (response.success) {
            setLastSuccessfulTestAt(new Date().toLocaleTimeString());
          }
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to run Claude healthcheck';
      const normalized = normalizeHealthcheckConfig(result.connector.healthcheck_config);
      if (!normalized) {
        setHealthcheckResult({
          success: false,
          message: `Claude healthcheck unavailable: ${message}`,
        });
        setTestedHealthcheckConfig(null);
        setLastSuccessfulTestAt(null);
      } else {
        try {
          const endpoint = resolveTemplate(normalized.endpoint, values);
          const resolvedHeaders = Object.fromEntries(
            Object.entries(normalized.headers).map(([key, val]) => [key, resolveTemplate(val, values)]),
          );

          const response = await fetch(endpoint, {
            method: normalized.method,
            headers: resolvedHeaders,
          });

          const expected = normalized.expected_status;
          const success = typeof expected === 'number'
            ? response.status === expected
            : response.ok;

          setHealthcheckResult({
            success,
            message: success
              ? `Connection successful (HTTP ${response.status}) using fallback check. Claude error: ${message}`
              : `Connection failed (HTTP ${response.status}) using fallback check. Claude error: ${message}`,
          });

          if (success) {
            setTestedHealthcheckConfig({
              endpoint: normalized.endpoint,
              method: normalized.method,
              headers: normalized.headers,
              expected_status: normalized.expected_status,
              description: normalized.description,
            });
            setLastSuccessfulTestAt(new Date().toLocaleTimeString());
          } else {
            setTestedHealthcheckConfig(null);
            setLastSuccessfulTestAt(null);
          }
        } catch (fallbackErr) {
          setHealthcheckResult({
            success: false,
            message: fallbackErr instanceof Error
              ? `Fallback healthcheck failed: ${fallbackErr.message}. Claude error: ${message}`
              : `Fallback healthcheck failed. Claude error: ${message}`,
          });
          setTestedHealthcheckConfig(null);
          setLastSuccessfulTestAt(null);
        }
      }
    } finally {
      setIsHealthchecking(false);
    }
  };

  const handleCredentialValuesChanged = (key: string, value: string) => {
    if (!testedValues) return;
    if (testedValues[key] === value) return;
    setHealthcheckResult(null);
    setTestedHealthcheckConfig(null);
    setTestedValues(null);
    setLastSuccessfulTestAt(null);
    if (oauthConsentCompletedAt) {
      setOauthConsentCompletedAt(null);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && phase === 'idle') {
      e.preventDefault();
      handleStart();
    }
  };

  const handleResetPreview = () => {
    reset();
    setHealthcheckResult(null);
    setTestedHealthcheckConfig(null);
    setTestedValues(null);
    setLastSuccessfulTestAt(null);
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

  const effectiveFields = isGoogleOAuthFlow
    ? fields.filter((f) => !['client_id', 'client_secret', 'refresh_token', 'scopes'].includes(f.key))
    : fields;

  const canSaveCredential = isGoogleOAuthFlow
    ? Boolean(oauthInitialValues.refresh_token)
    : (healthcheckResult?.success === true && testedHealthcheckConfig !== null);

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
      : `${template.label} template`;

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
    setHealthcheckResult(null);
    setTestedHealthcheckConfig(null);
    setShowTemplates(false);
  };

  const handleOAuthConsent = (values: Record<string, string>) => {
    const defaultScopes = [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/drive.file',
      'openid',
      'https://www.googleapis.com/auth/userinfo.email',
    ];

    const scopes = values.scopes?.trim()
      ? values.scopes.trim().split(/\s+/)
      : defaultScopes;
    setOauthScopeFromConsent(scopes.join(' '));

    setIsAuthorizingOAuth(true);
    setOauthConsentCompletedAt(null);
    setHealthcheckResult({
      success: false,
      message: 'Starting Google authorization (requesting OAuth session)...',
    });

    const startPromise = startGoogleCredentialOAuth(undefined, undefined, result?.connector.name || 'google', scopes);
    const timeoutPromise = new Promise<never>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error('OAuth session start timed out (no IPC response in 12s).'));
      }, 12000);
    });

    Promise.race([startPromise, timeoutPromise])
      .then(async (oauthStart) => {
        const resolved = oauthStart as { auth_url: string; session_id: string };
        let opened = false;
        if (!opened) {
          try {
            await openExternalUrl(resolved.auth_url);
            opened = true;
          } catch {
            // fallback below
          }
        }

        if (!opened) {
          try {
            const popup = window.open(resolved.auth_url, '_blank', 'noopener,noreferrer');
            opened = popup !== null;
          } catch {
            // no-op
          }
        }

        if (!opened) {
          throw new Error('Could not open Google consent page. Please allow popups or external browser open.');
        }

        setHealthcheckResult({
          success: false,
          message: 'Google consent page opened. Complete consent in browser; refresh token will be auto-filled.',
        });
        setOauthSessionId(resolved.session_id);
      })
      .catch((err) => {
        setOauthSessionId(null);
        setIsAuthorizingOAuth(false);
        setHealthcheckResult({
          success: false,
          message: err instanceof Error
            ? `Google authorization did not start: ${err.message}`
            : 'Google authorization did not start.',
        });
      });
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
              <p className="text-xs text-muted-foreground/50">
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
            className="p-2 rounded-lg hover:bg-secondary/60 text-muted-foreground/50 hover:text-foreground transition-colors"
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
              <PreviewPhase
                result={result}
                credentialName={credentialName}
                onCredentialNameChange={setCredentialName}
                fields={fields}
                effectiveFields={effectiveFields}
                requiredCount={requiredCount}
                optionalCount={optionalCount}
                firstSetupUrl={firstSetupUrl}
                isGoogleOAuthFlow={isGoogleOAuthFlow}
                oauthInitialValues={oauthInitialValues}
                isAuthorizingOAuth={isAuthorizingOAuth}
                oauthConsentCompletedAt={oauthConsentCompletedAt}
                isHealthchecking={isHealthchecking}
                healthcheckResult={healthcheckResult}
                canSaveCredential={canSaveCredential}
                lastSuccessfulTestAt={lastSuccessfulTestAt}
                onSave={handleSave}
                onOAuthConsent={handleOAuthConsent}
                onHealthcheck={handleHealthcheck}
                onValuesChanged={handleCredentialValuesChanged}
                onReset={handleResetPreview}
              />
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
                <p className="text-sm text-muted-foreground/50">Saving credential...</p>
              </motion.div>
            )}

            {phase === 'done' && (
              <DonePhase connectorLabel={result?.connector.label} onClose={handleClose} />
            )}

            {phase === 'error' && (
              <ErrorPhase error={error} onReset={reset} />
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
