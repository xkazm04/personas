import { useState, useEffect } from 'react';
import { X, Sparkles, AlertTriangle, CheckCircle, ArrowLeft, Plug, Loader2, Check, ExternalLink, Shield, ListChecks, KeyRound, CircleHelp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCredentialDesign } from '@/hooks/useCredentialDesign';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
import type { CredentialTemplateField } from '@/lib/types/types';
import { testCredentialDesignHealthcheck } from '@/api/tauriApi';
import { usePersonaStore } from '@/stores/personaStore';

interface CredentialDesignModalProps {
  open: boolean;
  embedded?: boolean;
  onClose: () => void;
  onComplete: () => void;
}

const QUICK_SERVICE_HINTS = [
  'OpenAI API key',
  'GitHub personal access token',
  'Slack bot token',
  'Stripe secret key',
  'Notion integration token',
  'Datadog API key',
];

interface RuntimeHealthcheckConfig {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  expected_status?: number;
  description?: string;
}

function extractFirstUrl(text?: string): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s)]+/i);
  return match ? match[0] : null;
}

function resolveTemplate(template: string, values: Record<string, string>): string {
  let resolved = template;
  for (const [key, value] of Object.entries(values)) {
    resolved = resolved.replaceAll(`{{${key}}}`, value);
  }
  return resolved;
}

function normalizeHealthcheckConfig(raw: unknown): RuntimeHealthcheckConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const cfg = raw as Record<string, unknown>;

  const endpoint = (typeof cfg.endpoint === 'string' ? cfg.endpoint : null)
    ?? (typeof cfg.url === 'string' ? cfg.url : null);

  if (!endpoint) return null;

  const method = typeof cfg.method === 'string' ? cfg.method.toUpperCase() : 'GET';

  const headers: Record<string, string> = {};
  if (cfg.headers && typeof cfg.headers === 'object') {
    for (const [key, value] of Object.entries(cfg.headers as Record<string, unknown>)) {
      if (typeof value === 'string') {
        headers[key] = value;
      }
    }
  }

  return {
    endpoint,
    method,
    headers,
    expected_status: typeof cfg.expected_status === 'number' ? cfg.expected_status : undefined,
    description: typeof cfg.description === 'string' ? cfg.description : undefined,
  };
}

export function CredentialDesignModal({ open, embedded = false, onClose, onComplete }: CredentialDesignModalProps) {
  const { phase, outputLines, result, error, start, cancel, save, reset, loadTemplate } = useCredentialDesign();
  const [instruction, setInstruction] = useState('');
  const [credentialName, setCredentialName] = useState('');
  const [isHealthchecking, setIsHealthchecking] = useState(false);
  const [healthcheckResult, setHealthcheckResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testedHealthcheckConfig, setTestedHealthcheckConfig] = useState<Record<string, unknown> | null>(null);
  const [lastSuccessfulTestAt, setLastSuccessfulTestAt] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);

  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);
  const isDevMode = import.meta.env.DEV;

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

      if (isDevMode) {
        fetchConnectorDefinitions();
      }
    }
  }, [open, reset, fetchConnectorDefinitions, isDevMode]);

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

  const handleCredentialValuesChanged = () => {
    if (healthcheckResult || testedHealthcheckConfig) {
      setHealthcheckResult(null);
      setTestedHealthcheckConfig(null);
      setLastSuccessfulTestAt(null);
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

  if (!open) return null;

  // Map result fields to CredentialTemplateField format
  const fields: CredentialTemplateField[] = result?.connector.fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type as CredentialTemplateField['type'],
    required: f.required,
    placeholder: f.placeholder,
  })) ?? [];

  const firstSetupUrl = extractFirstUrl(result?.setup_instructions);
  const requiredCount = fields.filter((f) => f.required).length;
  const optionalCount = Math.max(0, fields.length - requiredCount);
  const canSaveCredential = healthcheckResult?.success === true && testedHealthcheckConfig !== null;

  const templateConnectors = connectorDefinitions.filter((conn) => {
    const metadata = conn.metadata as Record<string, unknown> | null;
    if (!metadata || !isDevMode) return false;
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
            {/* Idle: Input Phase */}
            {phase === 'idle' && (
              <motion.div
                key="input"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <div className="text-xs text-muted-foreground/80">
                  Describe the tool and credential type. Claude will generate the exact fields you need, then you can save them securely.
                </div>

                <div className="flex flex-wrap gap-2">
                  {isDevMode && (
                    <button
                      onClick={() => setShowTemplates((prev) => !prev)}
                      className="px-2.5 py-1 text-xs rounded-lg border border-primary/20 text-primary hover:bg-primary/10 transition-colors"
                    >
                      From Template
                    </button>
                  )}

                  {QUICK_SERVICE_HINTS.map((hint) => (
                    <button
                      key={hint}
                      onClick={() => setInstruction(hint)}
                      className="px-2.5 py-1 text-xs rounded-lg border border-primary/15 text-foreground/85 hover:bg-secondary/60 transition-colors"
                    >
                      {hint}
                    </button>
                  ))}
                </div>

                {isDevMode && showTemplates && (
                  <div className="p-3 rounded-xl border border-primary/15 bg-secondary/20 space-y-2">
                    <p className="text-xs text-muted-foreground/75">Saved local templates</p>
                    <input
                      type="text"
                      value={templateSearch}
                      onChange={(e) => setTemplateSearch(e.target.value)}
                      placeholder="Search templates"
                      className="w-full px-3 py-1.5 rounded-lg border border-primary/15 bg-background/40 text-xs text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                    {templateConnectors.length === 0 ? (
                      <p className="text-xs text-muted-foreground/70">No templates yet. Save a successfully tested connector first.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                        {templateConnectors.map((conn) => (
                          <div key={conn.id} className="rounded-lg border border-primary/10 bg-background/30 overflow-hidden">
                            <div
                              onClick={() => setExpandedTemplateId((prev) => (prev === conn.id ? null : conn.id))}
                              className="w-full px-2.5 py-2 flex items-center justify-between gap-2 hover:bg-secondary/40 transition-colors text-left cursor-pointer"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <div
                                  className="w-6 h-6 rounded-md border flex items-center justify-center"
                                  style={{
                                    backgroundColor: `${conn.color}15`,
                                    borderColor: `${conn.color}30`,
                                  }}
                                >
                                  <Plug className="w-3.5 h-3.5" style={{ color: conn.color }} />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs text-foreground truncate">{conn.label}</p>
                                  <p className="text-[10px] text-muted-foreground/65 truncate">{conn.category}</p>
                                </div>
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  applyTemplate(conn.name);
                                }}
                                className="px-2 py-1 text-[11px] rounded-md border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
                              >
                                Use
                              </button>
                            </div>
                            <AnimatePresence>
                              {expandedTemplateId === conn.id && (
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden border-t border-primary/10"
                                >
                                  <div className="px-2.5 py-2 text-[11px] text-muted-foreground/80">
                                    {(() => {
                                      const meta = (conn.metadata ?? {}) as Record<string, unknown>;
                                      if (typeof meta.summary === 'string' && meta.summary.trim()) {
                                        return meta.summary;
                                      }
                                      return `${conn.fields.length} fields`;
                                    })()}
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g. Slack, OpenAI, GitHub, Stripe..."
                  rows={3}
                  autoFocus
                  className="w-full px-4 py-3 bg-secondary/40 border border-primary/15 rounded-xl text-foreground text-sm placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all resize-none"
                />
                <div className="flex justify-end">
                  <button
                    onClick={handleStart}
                    disabled={!instruction.trim()}
                    className="flex items-center gap-2 px-5 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-foreground rounded-xl text-sm font-medium transition-all shadow-lg shadow-primary/20"
                  >
                    <Sparkles className="w-4 h-4" />
                    Design Credential
                  </button>
                </div>
              </motion.div>
            )}

            {/* Analyzing Phase */}
            {phase === 'analyzing' && (
              <motion.div
                key="analyzing"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <div className="px-2 py-3 space-y-0.5">
                  {outputLines.map((line, i) => {
                    const isLast = i === outputLines.length - 1;
                    return (
                      <motion.div
                        key={i}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2 }}
                        className="flex items-center gap-3 py-1.5"
                      >
                        {isLast ? (
                          <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                        ) : (
                          <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        )}
                        <span className={`text-sm ${isLast ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                          {line}
                        </span>
                      </motion.div>
                    );
                  })}
                  {outputLines.length === 0 && (
                    <div className="flex items-center gap-3 py-1.5">
                      <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                      <span className="text-sm text-muted-foreground/50">Starting analysis...</span>
                    </div>
                  )}
                </div>
                <div className="px-3 py-2 rounded-xl bg-secondary/30 border border-primary/10 text-xs text-muted-foreground/80">
                  Claude is generating connector details, credential fields, and setup guidance based on your request.
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={cancel}
                    className="px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/70 rounded-xl text-sm transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            )}

            {/* Preview Phase */}
            {phase === 'preview' && result && (
              <motion.div
                key="preview"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-5"
              >
                {/* Match existing banner */}
                {result.match_existing && (
                  <div className="flex items-start gap-3 px-4 py-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                    <Plug className="w-4 h-4 mt-0.5 text-blue-400 shrink-0" />
                    <div className="text-sm">
                      <span className="text-blue-300 font-medium">Existing connector found: </span>
                      <span className="text-blue-400">{result.match_existing}</span>
                      <p className="text-blue-300/60 text-xs mt-1">
                        Your credential will be linked to the existing connector definition.
                      </p>
                    </div>
                  </div>
                )}

                {/* Connector preview */}
                <div className="flex items-center gap-3 px-4 py-3 bg-secondary/40 border border-primary/10 rounded-xl">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center border"
                    style={{
                      backgroundColor: `${result.connector.color}15`,
                      borderColor: `${result.connector.color}30`,
                    }}
                  >
                    <Plug className="w-5 h-5" style={{ color: result.connector.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-foreground text-sm">{result.connector.label}</h4>
                    <p className="text-xs text-muted-foreground/80">{result.summary}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 border border-primary/10 text-[11px] text-foreground/85">
                      <ListChecks className="w-3 h-3" />
                      {fields.length}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 border border-primary/10 text-[11px] text-foreground/85">
                      <KeyRound className="w-3 h-3" />
                      {requiredCount}
                    </span>
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 border border-primary/10 text-[11px] text-foreground/85">
                      <CircleHelp className="w-3 h-3" />
                      {optionalCount}
                    </span>
                  </div>
                  <span className="px-2 py-0.5 bg-primary/10 text-primary/70 text-xs rounded-md font-mono">
                    {result.connector.category}
                  </span>
                </div>

                {/* Setup instructions */}
                {result.setup_instructions && (
                  <details className="group rounded-xl border border-primary/10 bg-secondary/20 px-4 py-3">
                    <summary className="cursor-pointer text-xs text-foreground/85 hover:text-foreground transition-colors font-medium">
                      Setup instructions
                    </summary>
                    <div className="mt-3 px-4 py-3 bg-background/40 rounded-xl border border-primary/10">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        className="prose prose-invert prose-sm max-w-none text-foreground/90 prose-p:my-1.5 prose-headings:my-2 prose-li:my-0.5 prose-strong:text-foreground prose-code:text-amber-300"
                      >
                        {result.setup_instructions}
                      </ReactMarkdown>
                    </div>
                    {firstSetupUrl && (
                      <div className="mt-2">
                        <button
                          onClick={() => window.open(firstSetupUrl, '_blank', 'noopener,noreferrer')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-primary/20 text-foreground/90 hover:bg-secondary/50 transition-colors"
                        >
                          Open setup page
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </details>
                )}

                {/* Credential name */}
                <div>
                  <label className="block text-sm font-medium text-foreground/80 mb-1.5">
                    Credential Name
                  </label>
                  <input
                    type="text"
                    value={credentialName}
                    onChange={(e) => setCredentialName(e.target.value)}
                    placeholder={`${result.connector.label} Credential`}
                    className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground text-sm placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
                  />
                </div>

                {/* Credential fields form */}
                <div className="flex items-start gap-2.5 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <Shield className="w-4 h-4 text-emerald-300 mt-0.5 shrink-0" />
                  <p className="text-xs text-emerald-200/80">
                    Credentials are stored securely in the app vault and are available for agent tool execution.
                  </p>
                </div>

                <CredentialEditForm
                  fields={fields}
                  onSave={handleSave}
                  onHealthcheck={handleHealthcheck}
                  testHint="Run Test Connection to let Claude choose the best endpoint for this service and verify your entered credentials dynamically."
                  onValuesChanged={handleCredentialValuesChanged}
                  isHealthchecking={isHealthchecking}
                  healthcheckResult={healthcheckResult}
                  saveDisabled={!canSaveCredential}
                  saveDisabledReason="Save is locked until Test Connection succeeds for the current credential values."
                  onCancel={() => {
                    reset();
                    setHealthcheckResult(null);
                    setTestedHealthcheckConfig(null);
                    setLastSuccessfulTestAt(null);
                  }}
                />

                {canSaveCredential && lastSuccessfulTestAt && (
                  <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-xs">
                    <CheckCircle className="w-3.5 h-3.5" />
                    Tested successfully at {lastSuccessfulTestAt}
                  </div>
                )}
              </motion.div>
            )}

            {/* Saving Phase */}
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

            {/* Done Phase */}
            {phase === 'done' && (
              <motion.div
                key="done"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-12 gap-4"
              >
                <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
                  <CheckCircle className="w-6 h-6 text-emerald-400" />
                </div>
                <div className="text-center">
                  <h3 className="text-sm font-semibold text-foreground">Credential Created</h3>
                  <p className="text-xs text-muted-foreground/50 mt-1">
                    {result?.connector.label} credential has been securely saved.
                  </p>
                </div>
                <button
                  onClick={handleClose}
                  className="mt-2 px-5 py-2 bg-primary hover:bg-primary/90 text-foreground rounded-xl text-sm font-medium transition-all"
                >
                  Done
                </button>
              </motion.div>
            )}

            {/* Error Phase */}
            {phase === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-4"
              >
                <div className="flex items-start gap-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <AlertTriangle className="w-4 h-4 mt-0.5 text-red-400 shrink-0" />
                  <div className="text-sm text-red-300">
                    {error || 'An unexpected error occurred.'}
                  </div>
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    onClick={reset}
                    className="flex items-center gap-2 px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/70 rounded-xl text-sm transition-colors"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    Try Again
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
