import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, Wrench, CheckCircle2, AlertCircle, XCircle, Activity, Loader2, RefreshCw, ChevronDown, Star, Plus, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { translateHealthcheckMessage } from '@/features/vault/components/credential-design/CredentialDesignHelpers';
import { CredentialDesignModal } from '@/features/vault/components/CredentialDesignModal';
import { parseDesignContext, mergeCredentialLink } from '@/features/shared/components/UseCasesList';

interface ConnectorStatus {
  name: string;
  credentialId: string | null;
  credentialName: string | null;
  testing: boolean;
  result: { success: boolean; message: string } | null;
}

const STATUS_CONFIG = {
  ready: { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', label: 'Ready' },
  untested: { color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', label: 'Untested' },
  failed: { color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', label: 'Failed' },
  missing: { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', label: 'No credential' },
  testing: { color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', label: 'Testing...' },
} as const;

function getStatusKey(status: ConnectorStatus): keyof typeof STATUS_CONFIG {
  if (status.testing) return 'testing';
  if (!status.credentialId) return 'missing';
  if (!status.result) return 'untested';
  return status.result.success ? 'ready' : 'failed';
}

interface PersonaConnectorsTabProps {
  onMissingCountChange?: (count: number) => void;
}

export function PersonaConnectorsTab({ onMissingCountChange }: PersonaConnectorsTabProps) {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const credentials = usePersonaStore((s) => s.credentials);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const healthcheckCredential = usePersonaStore((s) => s.healthcheckCredential);
  const updatePersona = usePersonaStore((s) => s.updatePersona);

  const [statuses, setStatuses] = useState<ConnectorStatus[]>([]);
  const [linkingConnector, setLinkingConnector] = useState<string | null>(null);
  const [testingAll, setTestingAll] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);
  const [designInstruction, setDesignInstruction] = useState('');

  const tools = selectedPersona?.tools ?? [];

  // Extract unique credential types needed by tools
  const requiredCredTypes = useMemo(() => {
    const types = new Set<string>();
    for (const tool of tools) {
      if (tool.requires_credential_type) {
        types.add(tool.requires_credential_type);
      }
    }
    return [...types];
  }, [tools]);

  // Load persisted credential links from design_context
  const credentialLinks = useMemo(
    () => parseDesignContext(selectedPersona?.design_context).credential_links ?? {},
    [selectedPersona?.design_context],
  );

  // Build connector statuses
  useEffect(() => {
    if (requiredCredTypes.length === 0) {
      setStatuses([]);
      return;
    }

    setStatuses((prev) => {
      return requiredCredTypes.map((credType) => {
        const matchedCred = credentials.find((c) => c.service_type === credType);
        const existing = prev.find((p) => p.name === credType);
        const linkedCredId = credentialLinks[credType];
        const linkedCred = linkedCredId ? credentials.find((c) => c.id === linkedCredId) : null;

        return {
          name: credType,
          credentialId: existing?.credentialId ?? matchedCred?.id ?? linkedCred?.id ?? null,
          credentialName: existing?.credentialName ?? matchedCred?.name ?? linkedCred?.name ?? null,
          testing: existing?.testing ?? false,
          result: existing?.result ?? null,
        };
      });
    });
  }, [requiredCredTypes, credentials, credentialLinks]);

  useEffect(() => {
    void fetchCredentials().catch(() => {});
  }, [fetchCredentials]);

  // Auto-test on mount
  const [autoTested] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    for (const status of statuses) {
      if (status.credentialId && !status.result && !status.testing && !autoTested.has(status.name)) {
        autoTested.add(status.name);
        void testConnector(status.name, status.credentialId);
      }
    }
  }, [statuses]);

  const testConnector = useCallback(async (name: string, credentialId: string) => {
    setStatuses((prev) =>
      prev.map((s) => s.name === name ? { ...s, testing: true, result: null } : s),
    );
    try {
      const result = await healthcheckCredential(credentialId);
      setStatuses((prev) =>
        prev.map((s) => s.name === name ? { ...s, testing: false, result } : s),
      );
    } catch (err) {
      setStatuses((prev) =>
        prev.map((s) =>
          s.name === name
            ? { ...s, testing: false, result: { success: false, message: err instanceof Error ? err.message : 'Healthcheck failed' } }
            : s,
        ),
      );
    }
  }, [healthcheckCredential]);

  const handleTestAll = async () => {
    setTestingAll(true);
    for (const status of statuses.filter((s) => s.credentialId)) {
      await testConnector(status.name, status.credentialId!);
    }
    setTestingAll(false);
  };

  const handleLinkCredential = (connectorName: string, credentialId: string, credentialName: string) => {
    setStatuses((prev) =>
      prev.map((s) =>
        s.name === connectorName
          ? { ...s, credentialId, credentialName, result: null }
          : s,
      ),
    );
    setLinkingConnector(null);

    // Persist to persona's design_context
    if (selectedPersona) {
      const newDesignContext = mergeCredentialLink(selectedPersona.design_context, connectorName, credentialId);
      void updatePersona(selectedPersona.id, { design_context: newDesignContext });
    }

    void testConnector(connectorName, credentialId);
  };

  const handleAddCredential = (connectorName: string) => {
    setLinkingConnector(null);
    setDesignInstruction(`${connectorName} API credential`);
    setDesignOpen(true);
  };

  const handleDesignComplete = () => {
    setDesignOpen(false);
    setDesignInstruction('');
    void fetchCredentials().catch(() => {});
  };

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/80">
        No persona selected
      </div>
    );
  }

  const testableCount = statuses.filter((s) => s.credentialId).length;
  const readyCount = statuses.filter((s) => s.result?.success).length;
  const missingCount = statuses.filter((s) => !s.credentialId).length;

  // Report missing count to parent
  useEffect(() => {
    onMissingCountChange?.(missingCount);
  }, [missingCount, onMissingCountChange]);

  return (
    <div className="space-y-6">
      {/* Readiness warning */}
      {missingCount > 0 && (
        <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/15">
          <AlertTriangle className="w-4 h-4 text-amber-400/70 flex-shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-amber-400/80">
              {missingCount} connector{missingCount !== 1 ? 's' : ''} need credentials before execution
            </p>
            <p className="text-amber-400/50 mt-0.5">
              Link or create credentials for all connectors to enable execution.
            </p>
          </div>
        </div>
      )}

      {/* Tools section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 px-1">
          <Wrench className="w-3.5 h-3.5 text-muted-foreground/80" />
          <p className="text-sm font-medium text-muted-foreground/80">
            {tools.length} tool{tools.length !== 1 ? 's' : ''} configured
          </p>
        </div>

        {tools.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {tools.map((tool) => (
              <span
                key={tool.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-lg border border-primary/10 bg-secondary/20 text-foreground/80"
                title={tool.description}
              >
                <Wrench className="w-3 h-3 text-muted-foreground/60" />
                {tool.name}
                {tool.requires_credential_type && (
                  <span className="text-[10px] text-muted-foreground/50">
                    ({tool.requires_credential_type})
                  </span>
                )}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground/60 px-1">No tools configured.</p>
        )}
      </div>

      {/* Connectors section */}
      {requiredCredTypes.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 px-1">
              <Link className="w-3.5 h-3.5 text-muted-foreground/80" />
              <p className="text-sm font-medium text-muted-foreground/80">
                {requiredCredTypes.length} connector{requiredCredTypes.length !== 1 ? 's' : ''} required
              </p>
              {readyCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <CheckCircle2 className="w-2.5 h-2.5" />
                  {readyCount} ready
                </span>
              )}
              {missingCount > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-sm rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  <AlertCircle className="w-2.5 h-2.5" />
                  {missingCount} missing
                </span>
              )}
            </div>

            {testableCount > 0 && (
              <button
                onClick={() => void handleTestAll()}
                disabled={testingAll}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 hover:text-foreground/95 transition-colors disabled:opacity-40"
              >
                {testingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Test All
              </button>
            )}
          </div>

          <div className="space-y-2">
            {statuses.map((status) => {
              const statusKey = getStatusKey(status);
              const config = STATUS_CONFIG[statusKey];
              const translated = status.result && !status.result.success
                ? translateHealthcheckMessage(status.result.message)
                : null;
              const isLinking = linkingConnector === status.name;
              const matchingCreds = credentials.filter((c) => c.service_type === status.name);
              const otherCreds = credentials.filter((c) => c.service_type !== status.name);

              return (
                <div key={status.name} className="bg-secondary/20 border border-primary/10 rounded-xl p-3.5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                      <Link className="w-3.5 h-3.5 text-emerald-400/60" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground/80 truncate">{status.name}</p>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-sm font-medium rounded-full border ${config.bg} ${config.color}`}>
                          {statusKey === 'testing' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                          {statusKey === 'ready' && <CheckCircle2 className="w-2.5 h-2.5" />}
                          {statusKey === 'failed' && <XCircle className="w-2.5 h-2.5" />}
                          {statusKey === 'missing' && <AlertCircle className="w-2.5 h-2.5" />}
                          {config.label}
                        </span>
                      </div>
                      {status.credentialName && (
                        <p className="text-sm text-muted-foreground/80 mt-0.5">
                          Credential: {status.credentialName}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {status.credentialId ? (
                        <button
                          onClick={() => void testConnector(status.name, status.credentialId!)}
                          disabled={status.testing}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 hover:text-foreground/95 transition-colors disabled:opacity-40"
                        >
                          {status.testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
                          Test
                        </button>
                      ) : (
                        <>
                          {credentials.length > 0 && (
                            <button
                              onClick={() => setLinkingConnector(isLinking ? null : status.name)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                                isLinking
                                  ? 'border-violet-500/30 text-violet-300 bg-violet-500/15'
                                  : 'border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 hover:text-foreground/95'
                              }`}
                            >
                              <ChevronDown className={`w-3 h-3 transition-transform ${isLinking ? 'rotate-180' : ''}`} />
                              Link Existing
                            </button>
                          )}
                          <button
                            onClick={() => handleAddCredential(status.name)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-violet-500/25 text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                            Add New
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Link picker */}
                  <AnimatePresence>
                    {isLinking && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <div className="mt-3 border border-primary/10 rounded-lg bg-background/40 max-h-48 overflow-y-auto">
                          {matchingCreds.length > 0 && (
                            <>
                              <p className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider border-b border-primary/5">Best match</p>
                              {matchingCreds.map((cred) => (
                                <button
                                  key={cred.id}
                                  onClick={() => handleLinkCredential(status.name, cred.id, cred.name)}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/40 transition-colors border-b border-primary/5 last:border-0"
                                >
                                  <Star className="w-3 h-3 text-amber-400/60 flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-foreground/80 truncate">{cred.name}</p>
                                    <p className="text-[10px] text-muted-foreground/60">{cred.service_type}</p>
                                  </div>
                                </button>
                              ))}
                            </>
                          )}
                          {otherCreds.length > 0 && (
                            <>
                              {matchingCreds.length > 0 && (
                                <p className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider border-b border-primary/5">Other credentials</p>
                              )}
                              {otherCreds.map((cred) => (
                                <button
                                  key={cred.id}
                                  onClick={() => handleLinkCredential(status.name, cred.id, cred.name)}
                                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/40 transition-colors border-b border-primary/5 last:border-0"
                                >
                                  <div className="w-3 h-3 flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-foreground/80 truncate">{cred.name}</p>
                                    <p className="text-[10px] text-muted-foreground/60">{cred.service_type}</p>
                                  </div>
                                </button>
                              ))}
                            </>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Result detail */}
                  {status.result && !status.testing && (
                    <div className={`mt-2.5 px-3 py-2 rounded-lg text-sm ${
                      status.result.success
                        ? 'bg-emerald-500/5 border border-emerald-500/15 text-emerald-400'
                        : 'bg-red-500/5 border border-red-500/15 text-red-400'
                    }`}>
                      {status.result.success ? (
                        <div className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
                          <span>{status.result.message}</span>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5">
                            <XCircle className="w-3 h-3 flex-shrink-0" />
                            <span>{translated?.friendly ?? status.result.message}</span>
                          </div>
                          {translated?.suggestion && (
                            <p className="text-sm text-red-400/60 pl-4.5">{translated.suggestion}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {requiredCredTypes.length === 0 && tools.length === 0 && (
        <div className="text-center py-8 text-muted-foreground/60 text-sm">
          No tools or connectors configured for this persona.
        </div>
      )}

      {/* Embedded credential design modal */}
      {designOpen && (
        <div className="mt-4 border border-violet-500/20 rounded-2xl overflow-hidden">
          <CredentialDesignModal
            open={designOpen}
            embedded
            initialInstruction={designInstruction}
            onClose={() => { setDesignOpen(false); setDesignInstruction(''); }}
            onComplete={handleDesignComplete}
          />
        </div>
      )}
    </div>
  );
}
