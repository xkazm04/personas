import { useState, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Download,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Wrench,
  Zap,
  Plug,
  Bell,
  FlaskConical,
  RefreshCw,
} from 'lucide-react';
import { ConnectorReadiness, deriveConnectorReadiness } from './ConnectorReadiness';
import { instantAdoptTemplate } from '@/api/templateAdopt';
import { usePersonaStore } from '@/stores/personaStore';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import type { DesignAnalysisResult, AdoptionRequirement, ConnectorReadinessStatus } from '@/lib/types/designTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import {
  getAdoptionRequirements,
  getDefaultValues,
  validateVariables,
  substituteVariables,
} from './templateVariables';

function parseJsonSafe<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

interface TemplateAdoptDialogProps {
  isOpen: boolean;
  onClose: () => void;
  review: PersonaDesignReview | null;
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  onPersonaCreated: () => void;
  onCustomizeWithAI: () => void;
}

export function TemplateAdoptDialog({
  isOpen,
  onClose,
  review,
  credentials,
  connectorDefinitions,
  onPersonaCreated,
  onCustomizeWithAI,
}: TemplateAdoptDialogProps) {
  const fetchPersonas = usePersonaStore((s) => s.fetchPersonas);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const backdropRef = useRef<HTMLDivElement>(null);

  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [adopting, setAdopting] = useState(false);
  const [adopted, setAdopted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<'ready' | 'partial' | 'blocked' | null>(null);

  // Parse design result
  const designResult = useMemo<DesignAnalysisResult | null>(() => {
    if (!review) return null;
    return parseJsonSafe(review.design_result, null);
  }, [review]);

  // Extract requirements and set defaults on mount
  const requirements = useMemo<AdoptionRequirement[]>(() => {
    if (!designResult) return [];
    return getAdoptionRequirements(designResult);
  }, [designResult]);

  // Initialize defaults when review changes
  useMemo(() => {
    if (requirements.length > 0) {
      setVariableValues(getDefaultValues(requirements));
      setTestResult(null);
      setError(null);
      setAdopted(false);
    }
  }, [requirements]);

  // Connector readiness
  const readinessStatuses = useMemo<ConnectorReadinessStatus[]>(() => {
    if (!designResult?.suggested_connectors) return [];
    const installedNames = new Set(connectorDefinitions.map((c) => c.name));
    const credTypes = new Set(credentials.map((c) => c.service_type));
    return deriveConnectorReadiness(designResult.suggested_connectors, installedNames, credTypes);
  }, [designResult, connectorDefinitions, credentials]);

  // Stat counts
  const toolCount = designResult?.suggested_tools?.length ?? 0;
  const triggerCount = designResult?.suggested_triggers?.length ?? 0;
  const connectorCount = designResult?.suggested_connectors?.length ?? 0;
  const channelCount = designResult?.suggested_notification_channels?.length ?? 0;

  // Variable form handlers
  const updateVariable = useCallback((key: string, value: string) => {
    setVariableValues((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  }, []);

  // Test feasibility
  const handleTest = useCallback(() => {
    if (!designResult) return;
    const validation = validateVariables(requirements, variableValues);
    const connectorsOk = readinessStatuses.every((s) => s.health === 'ready');
    const connectorsPartial = readinessStatuses.some((s) => s.health === 'ready');

    if (!validation.valid) {
      setTestResult('blocked');
      setError(`Missing required fields: ${validation.missing.join(', ')}`);
      return;
    }
    setError(null);

    if (readinessStatuses.length === 0 || connectorsOk) {
      setTestResult('ready');
    } else if (connectorsPartial) {
      setTestResult('partial');
    } else {
      setTestResult('blocked');
    }
  }, [designResult, requirements, variableValues, readinessStatuses]);

  // Adopt template
  const handleAdopt = useCallback(async () => {
    if (!designResult || !review || adopting) return;

    // Validate variables
    const validation = validateVariables(requirements, variableValues);
    if (!validation.valid) {
      setError(`Missing required fields: ${validation.missing.join(', ')}`);
      return;
    }

    setAdopting(true);
    setError(null);

    try {
      // Substitute variables into design result
      const substituted = substituteVariables(designResult, variableValues);
      const substitutedJson = JSON.stringify(substituted);

      const response = await instantAdoptTemplate(review.test_case_name, substitutedJson);
      await fetchPersonas();
      selectPersona(response.persona.id);
      setAdopted(true);
      onPersonaCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to adopt template.');
    } finally {
      setAdopting(false);
    }
  }, [designResult, review, adopting, requirements, variableValues, fetchPersonas, selectPersona, onPersonaCreated]);

  const handleClose = useCallback(() => {
    if (adopting) return;
    setVariableValues({});
    setTestResult(null);
    setError(null);
    setAdopted(false);
    onClose();
  }, [adopting, onClose]);

  if (!isOpen || !review) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={(e) => { if (e.target === backdropRef.current) handleClose(); }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-lg bg-background border border-primary/15 rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Download className="w-4.5 h-4.5 text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground/90">Adopt Template</h2>
              <p className="text-sm text-muted-foreground/90">{review.test_case_name}</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={adopting}
            className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/80 hover:text-foreground/95 disabled:opacity-30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 flex-1 overflow-y-auto min-h-0 space-y-4">
          {/* Success state */}
          {adopted && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-center"
            >
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              </div>
              <p className="text-sm font-semibold text-emerald-400 mb-1">Persona Created</p>
              <p className="text-sm text-emerald-400/60">
                {review.test_case_name} is ready to use. Find it in the sidebar.
              </p>
            </motion.div>
          )}

          {!adopted && (
            <>
              {/* Template summary */}
              <div>
                <p className="text-sm text-muted-foreground/90 leading-relaxed">
                  {designResult?.summary ?? review.instruction}
                </p>
              </div>

              {/* Stat pills */}
              <div className="flex flex-wrap gap-2">
                {connectorCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/15">
                    <Plug className="w-3.5 h-3.5" />
                    {connectorCount} Connector{connectorCount !== 1 ? 's' : ''}
                  </span>
                )}
                {toolCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary/10 text-foreground/80 border border-primary/15">
                    <Wrench className="w-3.5 h-3.5" />
                    {toolCount} Tool{toolCount !== 1 ? 's' : ''}
                  </span>
                )}
                {triggerCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/15">
                    <Zap className="w-3.5 h-3.5" />
                    {triggerCount} Trigger{triggerCount !== 1 ? 's' : ''}
                  </span>
                )}
                {channelCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/15">
                    <Bell className="w-3.5 h-3.5" />
                    {channelCount} Channel{channelCount !== 1 ? 's' : ''}
                  </span>
                )}
              </div>

              {/* Connector readiness */}
              {readinessStatuses.length > 0 && (
                <div className="pt-2 border-t border-primary/[0.08]">
                  <ConnectorReadiness statuses={readinessStatuses} compact={false} />
                </div>
              )}

              {/* Adoption variables form */}
              {requirements.length > 0 && (
                <div className="pt-2 border-t border-primary/[0.08] space-y-3">
                  <p className="text-sm font-medium text-foreground/80">Configuration</p>
                  {requirements.map((req) => (
                    <div key={req.key} className="space-y-1">
                      <label className="text-sm text-muted-foreground/90 flex items-center gap-1">
                        {req.label}
                        {req.required && <span className="text-red-400">*</span>}
                      </label>
                      {req.description && (
                        <p className="text-sm text-muted-foreground/60">{req.description}</p>
                      )}
                      {req.type === 'select' && req.options ? (
                        <select
                          value={variableValues[req.key] ?? ''}
                          onChange={(e) => updateVariable(req.key, e.target.value)}
                          className="w-full px-3 py-2 text-sm bg-background/50 border border-primary/15 rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                        >
                          <option value="">Select...</option>
                          {req.options.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type={req.type === 'url' ? 'url' : 'text'}
                          value={variableValues[req.key] ?? ''}
                          onChange={(e) => updateVariable(req.key, e.target.value)}
                          placeholder={
                            req.type === 'cron' ? '0 */15 * * * (every 15 min)' :
                            req.type === 'url' ? 'https://...' :
                            `Enter ${req.label.toLowerCase()}...`
                          }
                          className="w-full px-3 py-2 text-sm bg-background/50 border border-primary/15 rounded-lg text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Test result */}
              <AnimatePresence>
                {testResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className={`flex items-start gap-3 p-3 rounded-xl border ${
                      testResult === 'ready'
                        ? 'bg-emerald-500/10 border-emerald-500/20'
                        : testResult === 'partial'
                          ? 'bg-amber-500/10 border-amber-500/20'
                          : 'bg-red-500/10 border-red-500/20'
                    }`}
                  >
                    {testResult === 'ready' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                        testResult === 'partial' ? 'text-amber-400' : 'text-red-400'
                      }`} />
                    )}
                    <p className={`text-sm flex-1 ${
                      testResult === 'ready'
                        ? 'text-emerald-400/80'
                        : testResult === 'partial'
                          ? 'text-amber-400/80'
                          : 'text-red-400/80'
                    }`}>
                      {testResult === 'ready' && 'All checks passed. Ready to adopt.'}
                      {testResult === 'partial' && 'Some connectors need setup. You can still adopt and configure later.'}
                      {testResult === 'blocked' && 'Setup required before this template can work.'}
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}

          {/* Error banner */}
          {error && !adopted && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20"
            >
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-400/80 flex-1">{error}</p>
            </motion.div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-primary/10 bg-secondary/10 flex-shrink-0">
          {adopted ? (
            <>
              <div />
              <button
                onClick={handleClose}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" />
                Done
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onCustomizeWithAI}
                disabled={adopting}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 disabled:opacity-30 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Customize with AI
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleTest}
                  disabled={adopting}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 disabled:opacity-30 transition-colors"
                >
                  <FlaskConical className="w-3.5 h-3.5" />
                  Test
                </button>
                <button
                  onClick={() => void handleAdopt()}
                  disabled={adopting}
                  className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 disabled:opacity-40 transition-colors"
                >
                  {adopting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Adopting...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Adopt Now
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
