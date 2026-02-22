import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, CheckCircle2, AlertCircle, XCircle, Activity, Loader2, Plus, RefreshCw, ChevronDown, Star } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { N8nPersonaDraft } from '@/api/design';
import { usePersonaStore } from '@/stores/personaStore';
import { translateHealthcheckMessage } from '@/features/vault/components/credential-design/CredentialDesignHelpers';
import { CredentialDesignModal } from '@/features/vault/components/CredentialDesignModal';

interface N8nConnectorsTabProps {
  draft: N8nPersonaDraft;
  onCredentialCreated?: () => void;
  /** Called when the number of unmapped connectors changes */
  onMissingCountChange?: (count: number) => void;
  /** Manually linked credentials persisted across tab switches */
  manualLinks?: Record<string, { id: string; name: string }>;
  /** Called when a credential is manually linked to a connector */
  onLink?: (connectorName: string, credentialId: string, credentialName: string) => void;
}

interface ConnectorStatus {
  name: string;
  n8nType: string;
  credentialId: string | null;
  credentialName: string | null;
  hasConnectorDef: boolean;
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

export function N8nConnectorsTab({ draft, onCredentialCreated, onMissingCountChange, manualLinks, onLink }: N8nConnectorsTabProps) {
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);
  const healthcheckCredential = usePersonaStore((s) => s.healthcheckCredential);

  const [statuses, setStatuses] = useState<ConnectorStatus[]>([]);
  const [designOpen, setDesignOpen] = useState(false);
  const [designInstruction, setDesignInstruction] = useState('');
  const [testingAll, setTestingAll] = useState(false);
  const [linkingConnector, setLinkingConnector] = useState<string | null>(null);

  // Extract required_connectors from draft
  const draftConnectors = useMemo(() => {
    const draftObj = draft as unknown as Record<string, unknown>;
    if (!Array.isArray(draftObj.required_connectors)) return [];
    return draftObj.required_connectors as { name: string; n8n_credential_type: string; has_credential: boolean }[];
  }, [draft]);

  // Build connector statuses from draft + store data + manual links
  useEffect(() => {
    if (draftConnectors.length === 0) {
      setStatuses([]);
      return;
    }

    setStatuses((prev) => {
      return draftConnectors.map((conn) => {
        const matchedCred = credentials.find((c) => c.service_type === conn.name);
        const matchedDef = connectorDefinitions.find((c) => c.name === conn.name);
        const existing = prev.find((p) => p.name === conn.name);
        const manual = manualLinks?.[conn.name];

        return {
          name: conn.name,
          n8nType: conn.n8n_credential_type,
          credentialId: existing?.credentialId ?? manual?.id ?? matchedCred?.id ?? null,
          credentialName: existing?.credentialName ?? manual?.name ?? matchedCred?.name ?? null,
          hasConnectorDef: !!matchedDef,
          testing: existing?.testing ?? false,
          result: existing?.result ?? null,
        };
      });
    });
  }, [draftConnectors, credentials, connectorDefinitions, manualLinks]);

  // Fetch credentials and connector definitions on mount
  useEffect(() => {
    void fetchCredentials();
    void fetchConnectorDefinitions();
  }, [fetchCredentials, fetchConnectorDefinitions]);

  // Auto-test connectors with stored credentials on mount
  const hasAutoTestedRef = useState<Set<string>>(() => new Set())[0];

  useEffect(() => {
    for (const status of statuses) {
      if (status.credentialId && !status.result && !status.testing && !hasAutoTestedRef.has(status.name)) {
        hasAutoTestedRef.add(status.name);
        void testConnector(status.name, status.credentialId);
      }
    }
  }, [statuses]);

  const testConnector = useCallback(async (connectorName: string, credentialId: string) => {
    setStatuses((prev) =>
      prev.map((s) => s.name === connectorName ? { ...s, testing: true, result: null } : s),
    );

    try {
      const result = await healthcheckCredential(credentialId);
      setStatuses((prev) =>
        prev.map((s) => s.name === connectorName ? { ...s, testing: false, result } : s),
      );
    } catch (err) {
      setStatuses((prev) =>
        prev.map((s) =>
          s.name === connectorName
            ? { ...s, testing: false, result: { success: false, message: err instanceof Error ? err.message : 'Healthcheck failed' } }
            : s,
        ),
      );
    }
  }, [healthcheckCredential]);

  const handleTestAll = async () => {
    setTestingAll(true);
    const testable = statuses.filter((s) => s.credentialId);
    for (const status of testable) {
      await testConnector(status.name, status.credentialId!);
    }
    setTestingAll(false);
  };

  const handleAddCredential = (connectorName: string, n8nType: string) => {
    setLinkingConnector(null);
    setDesignInstruction(`${connectorName} API credential (n8n type: ${n8nType})`);
    setDesignOpen(true);
  };

  const handleLinkCredential = (connectorName: string, credentialId: string, credentialName: string) => {
    // Link the selected credential to this connector and auto-test
    setStatuses((prev) =>
      prev.map((s) =>
        s.name === connectorName
          ? { ...s, credentialId, credentialName, result: null }
          : s,
      ),
    );
    setLinkingConnector(null);
    // Persist the link in parent state so it survives tab switches
    onLink?.(connectorName, credentialId, credentialName);
    void testConnector(connectorName, credentialId);
  };

  const handleDesignComplete = () => {
    setDesignOpen(false);
    setDesignInstruction('');
    // Refresh store data so statuses update
    void fetchCredentials();
    void fetchConnectorDefinitions();
    onCredentialCreated?.();
  };

  const handleDesignClose = () => {
    setDesignOpen(false);
    setDesignInstruction('');
  };

  const testableCount = statuses.filter((s) => s.credentialId).length;
  const readyCount = statuses.filter((s) => s.result?.success).length;
  const missingCount = statuses.filter((s) => !s.credentialId).length;

  // Report missing count to parent
  useEffect(() => {
    onMissingCountChange?.(missingCount);
  }, [missingCount, onMissingCountChange]);

  if (draftConnectors.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground/80 text-sm">
        No connectors required for this persona.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <p className="text-sm text-muted-foreground/80">
            {statuses.length} connector{statuses.length !== 1 ? 's' : ''} required
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
            {testingAll ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
            Test All
          </button>
        )}
      </div>

      {/* Connector list */}
      <div className="space-y-2">
        {statuses.map((status) => {
          const statusKey = getStatusKey(status);
          const config = STATUS_CONFIG[statusKey];
          const translated = status.result && !status.result.success
            ? translateHealthcheckMessage(status.result.message)
            : null;
          const isLinking = linkingConnector === status.name;

          // Group credentials for the link picker: matching service_type first
          const matchingCreds = credentials.filter((c) => c.service_type === status.name);
          const otherCreds = credentials.filter((c) => c.service_type !== status.name);

          return (
            <div
              key={status.name}
              className="bg-secondary/20 border border-primary/10 rounded-xl p-3.5"
            >
              <div className="flex items-center gap-3">
                {/* Icon */}
                <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
                  <Link className="w-3.5 h-3.5 text-emerald-400/60" />
                </div>

                {/* Info */}
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
                  <p className="text-sm text-muted-foreground/80 mt-0.5">
                    {status.credentialName
                      ? `Credential: ${status.credentialName}`
                      : `n8n type: ${status.n8nType}`}
                  </p>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {status.credentialId ? (
                    <button
                      onClick={() => void testConnector(status.name, status.credentialId!)}
                      disabled={status.testing}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 hover:text-foreground/95 transition-colors disabled:opacity-40"
                    >
                      {status.testing ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Activity className="w-3 h-3" />
                      )}
                      Test
                    </button>
                  ) : (
                    <>
                      {/* Link Existing button */}
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
                      {/* Add New button */}
                      <button
                        onClick={() => handleAddCredential(status.name, status.n8nType)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-violet-500/25 text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 transition-colors"
                      >
                        <Plus className="w-3 h-3" />
                        Add New
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Link Existing credential picker */}
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
                          <p className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider border-b border-primary/5">
                            Best match
                          </p>
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
                            <p className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground/50 uppercase tracking-wider border-b border-primary/5">
                              Other credentials
                            </p>
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
                      {credentials.length === 0 && (
                        <p className="px-3 py-4 text-sm text-muted-foreground/60 text-center">
                          No stored credentials found
                        </p>
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

      {/* Embedded credential design modal */}
      {designOpen && (
        <div className="mt-4 border border-violet-500/20 rounded-2xl overflow-hidden">
          <CredentialDesignModal
            open={designOpen}
            embedded
            initialInstruction={designInstruction}
            onClose={handleDesignClose}
            onComplete={handleDesignComplete}
          />
        </div>
      )}
    </div>
  );
}
