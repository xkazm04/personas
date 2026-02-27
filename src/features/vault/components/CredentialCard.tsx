import { useCallback, useEffect, useState } from 'react';
import { Trash2, Key, ChevronDown, ChevronRight, Wrench, Zap, Pencil, Plug, XCircle, BarChart3, RotateCw, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
import { CredentialEventConfig } from '@/features/vault/components/CredentialEventConfig';
import { CredentialIntelligence } from '@/features/vault/components/CredentialIntelligence';
import { CredentialRotationSection } from '@/features/vault/components/CredentialRotationSection';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { toCredentialMetadata, getAuthMethods } from '@/lib/types/types';
import { getAuthBadgeClasses } from '@/features/vault/utils/authMethodStyles';
import { isGoogleOAuthConnector } from '@/lib/utils/connectors';
import { useGoogleOAuth } from '@/features/vault/hooks/useGoogleOAuth';
import { usePersonaStore } from '@/stores/personaStore';
import * as api from '@/api/tauriApi';
import { formatTimestamp } from '@/lib/utils/formatters';
import type { RotationStatus } from '@/api/rotation';
import { getRotationStatus } from '@/api/rotation';

type ExpandedSection = 'services' | 'events' | 'intelligence' | 'rotation' | null;

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
  const [rotationStatus, setRotationStatus] = useState<RotationStatus | null>(null);
  const [rotationCountdown, setRotationCountdown] = useState<string | null>(null);

  const googleOAuth = useGoogleOAuth({
    onSuccess: () => setEditError(null),
    onError: (msg) => setEditError(msg),
  });

  const fetchRotationStatus = useCallback(async () => {
    try {
      const status = await getRotationStatus(credential.id);
      setRotationStatus(status);
    } catch {
      // No rotation data yet — that's fine
    }
  }, [credential.id]);

  // Fetch rotation status on mount (for header badge) and on expand
  useEffect(() => {
    fetchRotationStatus();
  }, [fetchRotationStatus]);

  // Countdown timer for next rotation
  useEffect(() => {
    if (!rotationStatus?.next_rotation_at) {
      setRotationCountdown(null);
      return;
    }
    const update = () => {
      const diff = Math.max(0, Math.floor((new Date(rotationStatus.next_rotation_at!).getTime() - Date.now()) / 1000));
      if (diff <= 0) {
        setRotationCountdown('Due now');
        return;
      }
      const d = Math.floor(diff / 86400);
      const h = Math.floor((diff % 86400) / 3600);
      if (d > 0) setRotationCountdown(`${d}d ${h}h`);
      else {
        const m = Math.floor((diff % 3600) / 60);
        setRotationCountdown(h > 0 ? `${h}h ${m}m` : `${m}m`);
      }
    };
    update();
    const timer = window.setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [rotationStatus?.next_rotation_at]);

  const isGoogleOAuthFlow = connector
    ? isGoogleOAuthConnector(connector, credential.service_type)
    : false;

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

  const handleOAuthConsent = (values: Record<string, string>) => {
    const extraScopes = values.scopes?.trim()
      ? values.scopes.trim().split(/\s+/)
      : undefined;
    setEditError(null);
    googleOAuth.startConsent(connector?.name || credential.service_type, extraScopes);
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
                {connector ? (
                  getAuthMethods(connector).map((m) => (
                    <span
                      key={m.id}
                      className={`text-sm px-1.5 py-0.5 rounded-md font-mono border shrink-0 ${getAuthBadgeClasses(m)}`}
                    >
                      {m.label}
                    </span>
                  ))
                ) : (
                  <span className="text-sm px-1.5 py-0.5 rounded-md font-mono border shrink-0 bg-secondary/40 border-primary/15 text-muted-foreground/60">
                    {credential.service_type}
                  </span>
                )}
                {rotationStatus?.policy_enabled && rotationCountdown && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex-shrink-0">
                    <RotateCw className="w-2.5 h-2.5 text-cyan-400/70" />
                    <span className="text-sm text-cyan-400/70 font-mono">{rotationCountdown}</span>
                  </span>
                )}
                {rotationStatus?.anomaly_detected && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 flex-shrink-0">
                    <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                    <span className="text-sm text-amber-400">Anomaly</span>
                  </span>
                )}
                {/* Field key tags */}
                {connector?.fields.slice(0, 3).map((f) => (
                  <span key={f.key} className="text-[10px] px-1 py-0.5 rounded bg-secondary/40 border border-primary/8 text-muted-foreground/50 font-mono shrink-0">
                    {f.key}
                  </span>
                ))}
                {connector && connector.fields.length > 3 && (
                  <span className="text-[10px] text-muted-foreground/40 shrink-0">+{connector.fields.length - 3}</span>
                )}
              </div>

              <div className="mt-1 text-sm text-muted-foreground/90">
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
              <ChevronDown className="w-4 h-4 text-muted-foreground/80" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground/80" />
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
              {/* Detail Section — credential config & health */}
              {connector ? (
                <div className="pt-3 space-y-3">
                  {editError && (
                    <div className="flex items-start gap-2.5 px-3 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
                      <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span className="flex-1">{editError}</span>
                      <button
                        onClick={() => setEditError(null)}
                        className="text-red-400/60 hover:text-red-400 text-sm font-medium shrink-0"
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                  {editingId === credential.id ? (
                    <CredentialEditForm
                      initialValues={googleOAuth.initialValues}
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
                          googleOAuth.reset();
                          setEditingId(null);
                        } catch (err) {
                          setEditError(err instanceof Error ? err.message : 'Failed to update credential');
                        }
                      }}
                      onOAuthConsent={isGoogleOAuthFlow ? handleOAuthConsent : undefined}
                      oauthConsentLabel={googleOAuth.isAuthorizing ? 'Authorizing with Google...' : 'Authorize with Google'}
                      oauthConsentDisabled={googleOAuth.isAuthorizing}
                      oauthConsentHint={isGoogleOAuthFlow ? 'Launches app-managed Google consent and updates refresh token after approval.' : undefined}
                      oauthConsentSuccessBadge={googleOAuth.completedAt ? `Google consent completed at ${googleOAuth.completedAt}` : undefined}
                      onCancel={() => setEditingId(null)}
                      onHealthcheck={(values) => onHealthcheck(credential.id, values, credential.service_type)}
                      onValuesChanged={() => {
                        if (googleOAuth.completedAt) {
                          googleOAuth.reset();
                        }
                      }}
                      isHealthchecking={isHealthchecking}
                      healthcheckResult={effectiveHealthcheckResult}
                    />
                  ) : (
                    <div className="space-y-3">
                      {/* Unified button panel */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <button
                          onClick={() => onHealthcheck(credential.id)}
                          disabled={isHealthchecking}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                        >
                          {isHealthchecking ? (
                            <div className="w-3 h-3 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
                          ) : (
                            <Key className="w-3 h-3" />
                          )}
                          Test
                        </button>
                        <button
                          onClick={() => setEditingId(credential.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/60 hover:bg-secondary border border-primary/15 text-foreground/90 rounded-lg text-sm font-medium transition-all"
                        >
                          <Pencil className="w-3 h-3" />
                          Edit
                        </button>
                        <button
                          onClick={() => setExpandedSection(expandedSection === 'intelligence' ? null : 'intelligence')}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            expandedSection === 'intelligence'
                              ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/25'
                              : 'bg-secondary/40 hover:bg-secondary/60 border border-primary/10 text-muted-foreground/80'
                          }`}
                        >
                          <BarChart3 className="w-3 h-3" />
                          Intelligence
                        </button>
                        <button
                          onClick={() => {
                            setExpandedSection(expandedSection === 'rotation' ? null : 'rotation');
                            if (expandedSection !== 'rotation') fetchRotationStatus();
                          }}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                            expandedSection === 'rotation'
                              ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25'
                              : 'bg-secondary/40 hover:bg-secondary/60 border border-primary/10 text-muted-foreground/80'
                          }`}
                        >
                          <RotateCw className="w-3 h-3" />
                          Rotation
                          {rotationStatus?.anomaly_detected && (
                            <AlertTriangle className="w-3 h-3 text-amber-400" />
                          )}
                        </button>
                        {connector.services.length > 0 && (
                          <button
                            onClick={() => setExpandedSection(expandedSection === 'services' ? null : 'services')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                              expandedSection === 'services'
                                ? 'bg-primary/10 text-primary border border-primary/20'
                                : 'bg-secondary/40 hover:bg-secondary/60 border border-primary/10 text-muted-foreground/80'
                            }`}
                          >
                            <Wrench className="w-3 h-3" />
                            Services ({connector.services.length})
                          </button>
                        )}
                        {connector.events.length > 0 && (
                          <button
                            onClick={() => setExpandedSection(expandedSection === 'events' ? null : 'events')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                              expandedSection === 'events'
                                ? 'bg-primary/10 text-primary border border-primary/20'
                                : 'bg-secondary/40 hover:bg-secondary/60 border border-primary/10 text-muted-foreground/80'
                            }`}
                          >
                            <Zap className="w-3 h-3" />
                            Events ({connector.events.length})
                          </button>
                        )}
                      </div>

                      {/* Healthcheck result */}
                      {(() => {
                        if (!effectiveHealthcheckResult) return null;
                        return (
                          <div className={`flex items-start gap-2 px-3 py-2 rounded-xl text-sm ${
                            effectiveHealthcheckResult.success
                              ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                              : 'bg-red-500/10 border border-red-500/20 text-red-400'
                          }`}>
                            <span className="font-semibold">{effectiveHealthcheckResult.success ? 'OK' : 'FAIL'}:</span>
                            <span>{effectiveHealthcheckResult.message}</span>
                          </div>
                        );
                      })()}

                      {/* Section content */}
                      {expandedSection && (
                        <div className="bg-secondary/10 border border-primary/6 rounded-xl p-4">
                          {expandedSection === 'services' && (
                            <div className="space-y-2">
                              {connector.services.map((service) => (
                                <div
                                  key={service.toolName}
                                  className="flex items-center gap-3 p-3 bg-secondary/20 border border-primary/10 rounded-xl border-l-2"
                                  style={{ borderLeftColor: connector.color || 'transparent' }}
                                >
                                  <Wrench className="w-3.5 h-3.5 text-muted-foreground/80" />
                                  <div>
                                    <span className="text-sm text-foreground/80">{service.label}</span>
                                    <span className="ml-2 text-xs font-mono text-muted-foreground/60">{service.toolName}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {expandedSection === 'events' && (
                            <CredentialEventConfig credentialId={credential.id} events={connector.events} />
                          )}
                          {expandedSection === 'intelligence' && (
                            <CredentialIntelligence credentialId={credential.id} />
                          )}
                          {expandedSection === 'rotation' && (
                            <CredentialRotationSection
                              credentialId={credential.id}
                              rotationStatus={rotationStatus}
                              rotationCountdown={rotationCountdown}
                              onRefresh={fetchRotationStatus}
                              onHealthcheck={onHealthcheck}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground/80 py-3">
                  No connector definition available for this credential type.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
