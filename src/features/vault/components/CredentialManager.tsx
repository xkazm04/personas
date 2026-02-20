import { useState, useEffect, useCallback, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { Plug, XCircle, Search, AlertTriangle, Undo2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
import { CredentialList } from '@/features/vault/components/CredentialList';
import { CredentialPicker } from '@/features/vault/components/CredentialPicker';
import { CredentialDesignModal } from '@/features/vault/components/CredentialDesignModal';
import { VaultStatusBadge } from '@/features/vault/components/VaultStatusBadge';
import type { ConnectorDefinition, CredentialMetadata } from '@/lib/types/types';
import * as api from '@/api/tauriApi';
import type { VaultStatus } from '@/api/tauriApi';

type TemplateMode = 'pick-type' | 'add-form';

export function CredentialManager() {
  const credentials = usePersonaStore((s) => s.credentials);
  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);
  const createCredential = usePersonaStore((s) => s.createCredential);
  const deleteCredential = usePersonaStore((s) => s.deleteCredential);
  const credentialView = usePersonaStore((s) => s.credentialView);
  const setCredentialView = usePersonaStore((s) => s.setCredentialView);

  const [loading, setLoading] = useState(true);
  const [templateMode, setTemplateMode] = useState<TemplateMode>('pick-type');
  const [selectedConnector, setSelectedConnector] = useState<ConnectorDefinition | null>(null);
  const [credentialName, setCredentialName] = useState('');
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [credentialSearch, setCredentialSearch] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const [oauthSessionId, setOauthSessionId] = useState<string | null>(null);
  const [isAuthorizingOAuth, setIsAuthorizingOAuth] = useState(false);
  const [pendingOAuthValues, setPendingOAuthValues] = useState<Record<string, string> | null>(null);
  const [oauthCompletedAt, setOauthCompletedAt] = useState<string | null>(null);

  // Confirmation dialog state
  const [deleteConfirm, setDeleteConfirm] = useState<{
    credential: CredentialMetadata;
    eventCount: number;
  } | null>(null);

  // Undo toast state
  const [undoToast, setUndoToast] = useState<{
    credentialId: string;
    credentialName: string;
    remaining: number;
  } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const undoCancelledRef = useRef(false);

  useEffect(() => {
    const init = async () => {
      await Promise.all([fetchCredentials(), fetchConnectorDefinitions()]);
      try {
        const vs = await api.vaultStatus();
        setVault(vs);
      } catch { /* vault status is best-effort */ }
      setLoading(false);
    };
    init();
  }, [fetchCredentials, fetchConnectorDefinitions]);

  const handlePickType = (connector: ConnectorDefinition) => {
    setSelectedConnector(connector);
    setCredentialName(`${connector.label} Credential`);
    setTemplateMode('add-form');
  };

  const isGoogleTemplate = Boolean(
    selectedConnector && (() => {
      const metadata = (selectedConnector.metadata ?? {}) as Record<string, unknown>;
      return metadata.oauth_type === 'google'
        || selectedConnector.name === 'google_workspace_oauth_template';
    })(),
  );

  const defaultGoogleScopes = [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/drive.file',
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
  ];

  const handleCreateCredential = async (values: Record<string, string>) => {
    if (!selectedConnector) return;

    const name = credentialName.trim() || `${selectedConnector.label} Credential`;

    try {
      setError(null);
      await createCredential({
        name,
        service_type: selectedConnector.name,
        data: values,
      });
      await fetchCredentials();
      setCredentialView('credentials');
      setSelectedConnector(null);
      setCredentialName('');
      setCredentialSearch('');
      setTemplateSearch('');
      setTemplateMode('pick-type');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create credential');
    }
  };

  const handleDeleteRequest = useCallback(async (credentialId: string) => {
    const cred = credentials.find((c) => c.id === credentialId);
    if (!cred) return;
    try {
      const events = await api.listCredentialEvents(credentialId);
      setDeleteConfirm({ credential: cred, eventCount: events.length });
    } catch {
      setDeleteConfirm({ credential: cred, eventCount: 0 });
    }
  }, [credentials]);

  useEffect(() => {
    if (!oauthSessionId) return;

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const status = await api.getGoogleCredentialOAuthStatus(oauthSessionId);
        if (cancelled) return;

        if (status.status === 'pending') {
          timer = window.setTimeout(poll, 1200);
          return;
        }

        setOauthSessionId(null);
        setIsAuthorizingOAuth(false);

        if (!selectedConnector || !pendingOAuthValues) {
          setError('OAuth finished but connector context was lost. Please retry.');
          return;
        }

        if (status.status !== 'success' || !status.refresh_token) {
          setError(status.error || 'Google authorization failed. Please retry.');
          return;
        }

        const nowIso = new Date().toISOString();
        const effectiveScopes = pendingOAuthValues.scopes?.trim()
          ? pendingOAuthValues.scopes.trim()
          : defaultGoogleScopes.join(' ');

        const { client_id: _clientId, client_secret: _clientSecret, ...safePendingValues } = pendingOAuthValues;

        const credentialData = {
          ...safePendingValues,
          refresh_token: status.refresh_token,
          scopes: effectiveScopes,
          oauth_scope: status.scope ?? effectiveScopes,
          oauth_completed_at: nowIso,
          oauth_client_mode: 'app_managed',
        };

        const name = credentialName.trim() || `${selectedConnector.label} Credential`;
        await createCredential({
          name,
          service_type: selectedConnector.name,
          data: credentialData,
        });

        setOauthCompletedAt(new Date().toLocaleTimeString());
        setPendingOAuthValues(null);
        await fetchCredentials();
        setCredentialView('credentials');
        setSelectedConnector(null);
        setCredentialName('');
        setCredentialSearch('');
        setTemplateSearch('');
        setTemplateMode('pick-type');
      } catch (err) {
        if (cancelled) return;
        setOauthSessionId(null);
        setIsAuthorizingOAuth(false);
        setError(err instanceof Error ? err.message : 'OAuth flow failed.');
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [oauthSessionId, selectedConnector, pendingOAuthValues, credentialName, createCredential, fetchCredentials, setCredentialView]);

  const handleTemplateOAuthConsent = (values: Record<string, string>) => {
    if (!selectedConnector) return;

    const scopes = values.scopes?.trim()
      ? values.scopes.trim().split(/\s+/)
      : defaultGoogleScopes;

    setError(null);
    setIsAuthorizingOAuth(true);
    setOauthCompletedAt(null);
    setPendingOAuthValues(values);

    const startPromise = api.startGoogleCredentialOAuth(undefined, undefined, selectedConnector.name, scopes);
    const timeoutPromise = new Promise<never>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error('OAuth session start timed out (no IPC response in 12s).'));
      }, 12000);
    });

    Promise.race([startPromise, timeoutPromise])
      .then(async (oauthStart) => {
        const resolved = oauthStart as api.GoogleCredentialOAuthStartResult;
        let opened = false;
        if (!opened) {
          try {
            await api.openExternalUrl(resolved.auth_url);
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

        setOauthSessionId(resolved.session_id);
      })
      .catch((err) => {
        setOauthSessionId(null);
        setIsAuthorizingOAuth(false);
        const message = err instanceof Error ? err.message : 'Failed to start Google authorization.';
        setError(`Google authorization did not start: ${message}`);
      });
  };

  const clearUndoTimer = useCallback(() => {
    if (undoTimerRef.current) {
      clearInterval(undoTimerRef.current);
      undoTimerRef.current = null;
    }
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteConfirm) return;
    const { credential } = deleteConfirm;
    setDeleteConfirm(null);
    undoCancelledRef.current = false;

    // Start 5-second undo countdown
    let remaining = 5;
    setUndoToast({ credentialId: credential.id, credentialName: credential.name, remaining });

    clearUndoTimer();
    undoTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0 || undoCancelledRef.current) {
        clearUndoTimer();
        if (!undoCancelledRef.current) {
          // Actually delete
          deleteCredential(credential.id).catch((err: unknown) => {
            setError(err instanceof Error ? err.message : 'Failed to delete credential');
          });
        }
        setUndoToast(null);
      } else {
        setUndoToast((prev) => prev ? { ...prev, remaining } : null);
      }
    }, 1000);
  }, [deleteConfirm, deleteCredential, clearUndoTimer]);

  const handleUndo = useCallback(() => {
    undoCancelledRef.current = true;
    clearUndoTimer();
    setUndoToast(null);
  }, [clearUndoTimer]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => { clearUndoTimer(); };
  }, [clearUndoTimer]);

  // Group connectors by category
  const filteredTemplateConnectors = connectorDefinitions.filter((connector) => {
    const q = templateSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      connector.label.toLowerCase().includes(q)
      || connector.name.toLowerCase().includes(q)
      || connector.category.toLowerCase().includes(q)
    );
  });

  const effectiveTemplateFields = selectedConnector?.fields
    ? (isGoogleTemplate
      ? selectedConnector.fields.filter((f) => !['client_id', 'client_secret', 'refresh_token', 'scopes'].includes(f.key))
      : selectedConnector.fields)
    : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="h-full p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-mono text-muted-foreground/50 uppercase tracking-wider">Credentials</h3>
          {vault && <VaultStatusBadge vault={vault} />}
        </div>
      </div>

      {credentialView === 'credentials' && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            type="text"
            value={credentialSearch}
            onChange={(e) => setCredentialSearch(e.target.value)}
            placeholder="Search credentials by name, type, or connector"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-primary/15 bg-secondary/25 text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      )}

      {credentialView === 'from-template' && templateMode === 'pick-type' && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            type="text"
            value={templateSearch}
            onChange={(e) => setTemplateSearch(e.target.value)}
            placeholder="Search templates by label, type, or category"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-primary/15 bg-secondary/25 text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2.5 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            onClick={() => setError(null)}
            className="text-red-400/60 hover:text-red-400 text-xs font-medium shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {credentialView === 'from-template' && templateMode === 'pick-type' && (
          <motion.div
            key="picker"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            <CredentialPicker
              connectors={filteredTemplateConnectors}
              onPickType={handlePickType}
            />
          </motion.div>
        )}

        {credentialView === 'from-template' && templateMode === 'add-form' && selectedConnector && (
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
                <p className="text-xs text-muted-foreground/40">
                  {selectedConnector.healthcheck_config?.description || 'Configure credential fields'}
                </p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-1.5">
                Credential Name
              </label>
              <input
                type="text"
                value={credentialName}
                onChange={(e) => setCredentialName(e.target.value)}
                placeholder={`My ${selectedConnector.label} Account`}
                className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground text-sm placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
              />
            </div>

            <CredentialEditForm
              fields={effectiveTemplateFields}
              onSave={handleCreateCredential}
              onOAuthConsent={isGoogleTemplate ? handleTemplateOAuthConsent : undefined}
              oauthConsentLabel={isAuthorizingOAuth ? 'Authorizing with Google...' : 'Authorize with Google'}
              oauthConsentDisabled={isAuthorizingOAuth}
              oauthConsentHint={isGoogleTemplate
                ? 'One click consent: uses app-managed Google OAuth and saves token metadata in background.'
                : undefined}
              oauthConsentSuccessBadge={oauthCompletedAt ? `Google consent completed at ${oauthCompletedAt}` : undefined}
              saveDisabled={isGoogleTemplate}
              saveDisabledReason={isGoogleTemplate ? 'Use Authorize with Google to create this credential.' : undefined}
              onValuesChanged={() => {
                if (oauthCompletedAt) setOauthCompletedAt(null);
              }}
              onCancel={() => {
                setTemplateMode('pick-type');
                setSelectedConnector(null);
                setIsAuthorizingOAuth(false);
                setOauthSessionId(null);
                setPendingOAuthValues(null);
              }}
            />
          </motion.div>
        )}

        {credentialView === 'credentials' && (
          <CredentialList
            credentials={credentials}
            connectorDefinitions={connectorDefinitions}
            searchTerm={credentialSearch}
            onDelete={handleDeleteRequest}
          />
        )}

        {credentialView === 'add-new' && (
          <motion.div
            key="design-inline"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-secondary/35 border border-primary/15 rounded-2xl p-4"
          >
            <CredentialDesignModal
              open
              embedded
              onClose={() => setCredentialView('credentials')}
              onComplete={() => {
                fetchCredentials();
                fetchConnectorDefinitions();
                setCredentialView('credentials');
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Dialog */}
      <AnimatePresence>
        {deleteConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setDeleteConfirm(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4"
            >
              <div className="bg-background border border-primary/15 rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center flex-shrink-0">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground/90">Delete Credential</h3>
                    <p className="text-xs text-muted-foreground/50 mt-1">This action cannot be undone after the undo window expires.</p>
                  </div>
                </div>

                <div className="bg-secondary/40 border border-primary/10 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase text-muted-foreground/40">Name</span>
                    <span className="text-sm text-foreground/80">{deleteConfirm.credential.name}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono uppercase text-muted-foreground/40">Type</span>
                    <span className="text-xs font-mono text-muted-foreground/60">{deleteConfirm.credential.service_type}</span>
                  </div>
                  {deleteConfirm.eventCount > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono uppercase text-muted-foreground/40">Event triggers</span>
                      <span className="text-xs font-medium text-amber-400">
                        {deleteConfirm.eventCount} will be removed
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="px-4 py-2 text-xs text-muted-foreground/60 hover:text-foreground/70 rounded-lg hover:bg-secondary/40 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteConfirm}
                    className="px-4 py-2 text-xs font-medium rounded-lg bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Undo Toast */}
      <AnimatePresence>
        {undoToast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="flex items-center gap-3 px-4 py-3 bg-background border border-primary/15 rounded-xl shadow-2xl">
              <span className="text-sm text-foreground/80">
                Deleting <span className="font-medium">{undoToast.credentialName}</span> in {undoToast.remaining}s
              </span>
              <button
                onClick={handleUndo}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Undo
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
