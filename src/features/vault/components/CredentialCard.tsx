import { useEffect, useState } from 'react';
import { Trash2, Key, ChevronDown, ChevronRight, Wrench, Zap, Pencil, Plug, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
import { CredentialEventConfig } from '@/features/vault/components/CredentialEventConfig';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { toCredentialMetadata } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';
import * as api from '@/api/tauriApi';
import { formatTimestamp } from '@/lib/utils/formatters';

type ExpandedSection = 'services' | 'events' | null;

interface CredentialCardProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onDelete: (id: string) => void;
  onHealthcheck: (id: string, fieldValues?: Record<string, string>, serviceType?: string) => void;
  isHealthchecking: boolean;
  healthcheckResult: { success: boolean; message: string } | null;
}

export function CredentialCard({
  credential,
  connector,
  isExpanded,
  onToggleExpand,
  onDelete,
  onHealthcheck,
  isHealthchecking,
  healthcheckResult,
}: CredentialCardProps) {
  const [expandedSection, setExpandedSection] = useState<ExpandedSection>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [oauthInitialValues, setOauthInitialValues] = useState<Record<string, string>>({});
  const [oauthSessionId, setOauthSessionId] = useState<string | null>(null);
  const [isAuthorizingOAuth, setIsAuthorizingOAuth] = useState(false);
  const [oauthConsentCompletedAt, setOauthConsentCompletedAt] = useState<string | null>(null);

  const connectorMetadata = (connector?.metadata ?? {}) as Record<string, unknown>;
  const isGoogleOAuthFlow = Boolean(
    connector && (
      credential.service_type.includes('google')
      || connectorMetadata.oauth_type === 'google'
      || connector.name === 'google_workspace_oauth_template'
    ),
  );

  const effectiveHealthcheckResult = healthcheckResult ?? (
    credential.healthcheck_last_success === null
      ? null
      : {
          success: credential.healthcheck_last_success,
          message: credential.healthcheck_last_message ?? 'Stored connection test result',
        }
  );

  const handleToggle = () => {
    if (!isExpanded) {
      setExpandedSection(null);
      setEditingId(null);
    }
    onToggleExpand();
  };

  useEffect(() => {
    if (!oauthSessionId) return;

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const status = await api.getGoogleCredentialOAuthStatus(oauthSessionId);
        if (cancelled) return;

        if (status.status === 'pending') {
          timer = window.setTimeout(poll, 1500);
          return;
        }

        setOauthSessionId(null);
        setIsAuthorizingOAuth(false);

        if (status.status === 'success' && status.refresh_token) {
          setOauthInitialValues((prev) => ({
            ...prev,
            refresh_token: status.refresh_token!,
            scopes: status.scope || prev.scopes || [
              'https://www.googleapis.com/auth/gmail.modify',
              'https://www.googleapis.com/auth/calendar.events',
              'https://www.googleapis.com/auth/drive.file',
              'openid',
              'https://www.googleapis.com/auth/userinfo.email',
            ].join(' '),
          }));
          setOauthConsentCompletedAt(new Date().toLocaleTimeString());
          setEditError(null);
          return;
        }

        setEditError(status.error || 'Google authorization failed. Please try again.');
      } catch (err) {
        if (cancelled) return;
        setOauthSessionId(null);
        setIsAuthorizingOAuth(false);
        setEditError(err instanceof Error ? err.message : 'Failed to check OAuth status.');
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [oauthSessionId]);

  const handleOAuthConsent = (values: Record<string, string>) => {
    const scopes = values.scopes?.trim()
      ? values.scopes.trim().split(/\s+/)
      : [
          'https://www.googleapis.com/auth/gmail.modify',
          'https://www.googleapis.com/auth/calendar.events',
          'https://www.googleapis.com/auth/drive.file',
          'openid',
          'https://www.googleapis.com/auth/userinfo.email',
        ];

    setIsAuthorizingOAuth(true);
    setOauthConsentCompletedAt(null);
    setEditError(null);

    api.startGoogleCredentialOAuth(undefined, undefined, connector?.name || credential.service_type, scopes)
      .then(async (oauthStart) => {
        let opened = false;
        try {
          await api.openExternalUrl(oauthStart.auth_url);
          opened = true;
        } catch {
          // fallback below
        }

        if (!opened) {
          try {
            const popup = window.open(oauthStart.auth_url, '_blank', 'noopener,noreferrer');
            opened = popup !== null;
          } catch {
            // no-op
          }
        }

        if (!opened) {
          throw new Error('Could not open Google consent page. Please allow popups or external browser open.');
        }

        setOauthSessionId(oauthStart.session_id);
      })
      .catch((err) => {
        setOauthSessionId(null);
        setIsAuthorizingOAuth(false);
        setEditError(err instanceof Error ? err.message : 'Failed to start Google authorization.');
      });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-secondary/25 backdrop-blur-sm border border-primary/15 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div
        className="px-3 py-2.5 cursor-pointer hover:bg-secondary/50 transition-colors"
        onClick={handleToggle}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 border"
              style={{
                backgroundColor: connector ? `${connector.color}15` : undefined,
                borderColor: connector ? `${connector.color}30` : undefined,
              }}
            >
              {connector?.icon_url ? (
                <img src={connector.icon_url} alt={connector.label} className="w-4 h-4" />
              ) : connector ? (
                <Plug className="w-4 h-4" style={{ color: connector.color }} />
              ) : (
                <Key className="w-4 h-4 text-emerald-400/80" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <h4 className="font-medium text-foreground text-sm truncate max-w-[220px] sm:max-w-[320px]">
                  {credential.name}
                </h4>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-md font-mono border shrink-0"
                  style={{
                    backgroundColor: connector ? `${connector.color}15` : undefined,
                    borderColor: connector ? `${connector.color}25` : undefined,
                    color: connector?.color,
                  }}
                >
                  {credential.service_type}
                </span>
                {isHealthchecking ? (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 flex-shrink-0">
                    <span className="w-2 h-2 rounded-full border border-amber-400 border-t-transparent animate-spin" />
                    <span className="text-[10px] text-amber-400">Checking…</span>
                  </span>
                ) : (
                  <span
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full flex-shrink-0 border ${
                      effectiveHealthcheckResult === null
                        ? 'bg-amber-500/10 border-amber-500/20'
                        : effectiveHealthcheckResult.success
                          ? 'bg-emerald-500/10 border-emerald-500/20'
                          : 'bg-red-500/10 border-red-500/20'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        effectiveHealthcheckResult === null
                          ? 'bg-amber-400/60'
                          : effectiveHealthcheckResult.success
                            ? 'bg-emerald-400'
                            : 'bg-red-400'
                      }`}
                    />
                    <span
                      className={`text-[10px] ${
                        effectiveHealthcheckResult === null
                          ? 'text-amber-400'
                          : effectiveHealthcheckResult.success
                            ? 'text-emerald-400'
                            : 'text-red-400'
                      }`}
                    >
                      {effectiveHealthcheckResult === null
                        ? 'Untested'
                        : effectiveHealthcheckResult.success
                          ? 'Healthy'
                          : 'Failed'}
                    </span>
                  </span>
                )}
              </div>

              <div className="mt-1 text-[11px] text-muted-foreground/70">
                Created {formatTimestamp(credential.created_at, 'Never')} · Last used {formatTimestamp(credential.last_used_at, 'Never')}
                {credential.healthcheck_last_tested_at && (
                  <> · Last tested {formatTimestamp(credential.healthcheck_last_tested_at, 'Never')}</>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <div onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => onDelete(credential.id)}
                className="p-1.5 hover:bg-red-500/10 rounded-lg transition-colors"
                title="Delete credential"
              >
                <Trash2 className="w-4 h-4 text-red-400/70" />
              </button>
            </div>
            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground/60" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground/60" />
            )}
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 border-t border-primary/10">
              {/* Section Tabs */}
              <div className="flex gap-1 pt-3 pb-3">
                {connector && connector.services.length > 0 && (
                  <button
                    onClick={() => setExpandedSection('services')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      expandedSection === 'services'
                        ? 'bg-primary/10 text-primary border border-primary/20'
                        : 'text-muted-foreground/50 hover:text-foreground/70 hover:bg-secondary/60'
                    }`}
                  >
                    <Wrench className="w-3 h-3" />
                    Services ({connector.services.length})
                  </button>
                )}
                {connector && connector.events.length > 0 && (
                  <button
                    onClick={() => setExpandedSection('events')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                      expandedSection === 'events'
                        ? 'bg-primary/10 text-primary border border-primary/20'
                        : 'text-muted-foreground/50 hover:text-foreground/70 hover:bg-secondary/60'
                    }`}
                  >
                    <Zap className="w-3 h-3" />
                    Events ({connector.events.length})
                  </button>
                )}
              </div>

              {/* Edit Section */}
              {connector && (
                <div className="space-y-3">
                  {editError && (
                    <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400">
                      <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span className="flex-1">{editError}</span>
                      <button
                        onClick={() => setEditError(null)}
                        className="text-red-400/60 hover:text-red-400 text-[10px] font-medium shrink-0"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                  {editingId === credential.id ? (
                    <CredentialEditForm
                      initialValues={oauthInitialValues}
                      fields={connector.fields}
                      onSave={async (values) => {
                        try {
                          setEditError(null);
                          const raw = await api.updateCredential(credential.id, {
                            name: null,
                            service_type: null,
                            encrypted_data: JSON.stringify(values),
                            iv: null,
                            metadata: credential.metadata,
                          });
                          const updated = toCredentialMetadata(raw);
                          usePersonaStore.setState((state) => ({
                            credentials: state.credentials.map((c) =>
                              c.id === credential.id ? updated : c
                            ),
                          }));
                          setOauthConsentCompletedAt(null);
                          setEditingId(null);
                        } catch (err) {
                          setEditError(err instanceof Error ? err.message : 'Failed to update credential');
                        }
                      }}
                      onOAuthConsent={isGoogleOAuthFlow ? handleOAuthConsent : undefined}
                      oauthConsentLabel={isAuthorizingOAuth ? 'Authorizing with Google...' : 'Authorize with Google'}
                      oauthConsentDisabled={isAuthorizingOAuth}
                      oauthConsentHint={isGoogleOAuthFlow ? 'Launches app-managed Google consent and updates refresh token after approval.' : undefined}
                      oauthConsentSuccessBadge={oauthConsentCompletedAt ? `Google consent completed at ${oauthConsentCompletedAt}` : undefined}
                      onCancel={() => setEditingId(null)}
                      onHealthcheck={(values) => onHealthcheck(credential.id, values, credential.service_type)}
                      onValuesChanged={() => {
                        if (oauthConsentCompletedAt) {
                          setOauthConsentCompletedAt(null);
                        }
                      }}
                      isHealthchecking={isHealthchecking}
                      healthcheckResult={effectiveHealthcheckResult}
                    />
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-muted-foreground/40">
                          {connector.healthcheck_config?.description || 'Credential configuration'}
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => onHealthcheck(credential.id)}
                            disabled={isHealthchecking}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 rounded-lg text-xs font-medium transition-all disabled:opacity-50"
                          >
                            {isHealthchecking ? (
                              <div className="w-3 h-3 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
                            ) : (
                              <Key className="w-3 h-3" />
                            )}
                            Test Connection
                          </button>
                          <button
                            onClick={() => setEditingId(credential.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/60 hover:bg-secondary border border-primary/15 text-foreground/70 rounded-lg text-xs font-medium transition-all"
                          >
                            <Pencil className="w-3 h-3" />
                            Edit Fields
                          </button>
                        </div>
                      </div>

                      {(() => {
                        if (!effectiveHealthcheckResult) return null;
                        return (
                          <div className={`flex items-start gap-2 px-3 py-2 rounded-xl text-xs ${
                            effectiveHealthcheckResult.success
                              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                              : 'bg-red-500/10 border border-red-500/20 text-red-400'
                          }`}>
                            <span>{effectiveHealthcheckResult.success ? 'OK' : 'FAIL'}:</span>
                            <span>{effectiveHealthcheckResult.message}</span>
                          </div>
                        );
                      })()}

                      {/* Show field names (not values - they're encrypted) */}
                      <div className="space-y-1">
                        {connector.fields.map((f) => (
                          <div key={f.key} className="flex items-center gap-2 text-xs text-muted-foreground/40">
                            <span className="font-mono text-muted-foreground/50">{f.key}</span>
                            <span className="text-muted-foreground/20">-</span>
                            <span>{f.label}</span>
                            {f.required && <span className="text-amber-400/60">(required)</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Edit section fallback for no connector */}
              {!connector && (
                <div className="text-xs text-muted-foreground/40 py-2">
                  No connector definition available for this credential type.
                </div>
              )}

              {/* Services Section */}
              {expandedSection === 'services' && connector && (
                <div className="space-y-2">
                  {connector.services.map((service) => (
                    <div
                      key={service.toolName}
                      className="flex items-center gap-3 p-3 bg-secondary/20 border border-primary/15 rounded-xl"
                    >
                      <Wrench className="w-3.5 h-3.5 text-muted-foreground/40" />
                      <div>
                        <span className="text-sm text-foreground/80">{service.label}</span>
                        <span className="ml-2 text-xs font-mono text-muted-foreground/30">{service.toolName}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Events Section */}
              {expandedSection === 'events' && connector && (
                <CredentialEventConfig
                  credentialId={credential.id}
                  events={connector.events}
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
