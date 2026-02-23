import { useCallback, useEffect, useState } from 'react';
import { Trash2, Key, ChevronDown, ChevronRight, Wrench, Zap, Pencil, Plug, XCircle, BarChart3, RotateCw, ShieldCheck, AlertTriangle, Clock, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
import { CredentialEventConfig } from '@/features/vault/components/CredentialEventConfig';
import { CredentialIntelligence } from '@/features/vault/components/CredentialIntelligence';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { toCredentialMetadata } from '@/lib/types/types';
import { isGoogleOAuthConnector } from '@/lib/utils/connectors';
import { useGoogleOAuth } from '@/features/vault/hooks/useGoogleOAuth';
import { usePersonaStore } from '@/stores/personaStore';
import * as api from '@/api/tauriApi';
import { formatTimestamp, formatRelativeTime } from '@/lib/utils/formatters';
import type { RotationStatus } from '@/api/rotation';
import { getRotationStatus, createRotationPolicy, updateRotationPolicy, rotateCredentialNow, deleteRotationPolicy } from '@/api/rotation';

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
  const [isRotating, setIsRotating] = useState(false);
  const [rotationCountdown, setRotationCountdown] = useState<string | null>(null);
  const [rotationDays, setRotationDays] = useState(90);
  const [isEditingPeriod, setIsEditingPeriod] = useState(false);

  const googleOAuth = useGoogleOAuth({
    onSuccess: () => setEditError(null),
    onError: (msg) => setEditError(msg),
  });

  const fetchRotationStatus = useCallback(async () => {
    try {
      const status = await getRotationStatus(credential.id);
      setRotationStatus(status);
      if (status.rotation_interval_days) {
        setRotationDays(status.rotation_interval_days);
      }
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
                <span
                  className="text-sm px-1.5 py-0.5 rounded-md font-mono border shrink-0"
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
                    <span className="text-sm text-amber-400">Checking…</span>
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
                      className={`text-sm ${
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
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground/80">
                          {connector.healthcheck_config?.description || 'Credential configuration'}
                        </p>
                        <div className="flex gap-2">
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
                            Test Connection
                          </button>
                          <button
                            onClick={() => setEditingId(credential.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-secondary/60 hover:bg-secondary border border-primary/15 text-foreground/90 rounded-lg text-sm font-medium transition-all"
                          >
                            <Pencil className="w-3 h-3" />
                            Edit Fields
                          </button>
                        </div>
                      </div>

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

                      {/* Field schema */}
                      <div className="bg-secondary/15 border border-primary/8 rounded-lg p-2.5 space-y-1">
                        <p className="text-sm font-semibold text-muted-foreground/60 uppercase tracking-wider mb-1.5">Fields</p>
                        {connector.fields.map((f) => (
                          <div key={f.key} className="flex items-center gap-2 text-sm py-0.5">
                            <span className="font-mono text-foreground/75 bg-secondary/30 px-1.5 py-px rounded">{f.key}</span>
                            <span className="text-muted-foreground/60">{f.label}</span>
                            {f.required && <span className="text-amber-400/50 text-sm">required</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground/80 py-3">
                  No connector definition available for this credential type.
                </div>
              )}

              {/* Divider between detail and section tabs */}
              <div className="my-3 border-t border-primary/8" />

              {/* Section Tabs */}
              <div className="flex gap-1 pb-3">
                {connector && connector.services.length > 0 && (
                  <button
                    onClick={() => setExpandedSection(expandedSection === 'services' ? null : 'services')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      expandedSection === 'services'
                        ? 'bg-primary/10 text-primary border border-primary/20'
                        : 'text-muted-foreground/90 hover:text-foreground/95 hover:bg-secondary/60 border border-transparent'
                    }`}
                  >
                    <Wrench className="w-3 h-3" />
                    Services ({connector.services.length})
                  </button>
                )}
                {connector && connector.events.length > 0 && (
                  <button
                    onClick={() => setExpandedSection(expandedSection === 'events' ? null : 'events')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      expandedSection === 'events'
                        ? 'bg-primary/10 text-primary border border-primary/20'
                        : 'text-muted-foreground/90 hover:text-foreground/95 hover:bg-secondary/60 border border-transparent'
                    }`}
                  >
                    <Zap className="w-3 h-3" />
                    Events ({connector.events.length})
                  </button>
                )}
                <button
                  onClick={() => setExpandedSection(expandedSection === 'intelligence' ? null : 'intelligence')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    expandedSection === 'intelligence'
                      ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/25'
                      : 'text-muted-foreground/90 hover:text-foreground/95 hover:bg-secondary/60 border border-transparent'
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
                      : 'text-muted-foreground/90 hover:text-foreground/95 hover:bg-secondary/60 border border-transparent'
                  }`}
                >
                  <RotateCw className="w-3 h-3" />
                  Rotation
                  {rotationStatus?.anomaly_detected && (
                    <AlertTriangle className="w-3 h-3 text-amber-400" />
                  )}
                </button>
              </div>

              {/* Section Content */}
              {expandedSection && <div className="border-t border-primary/8 pt-3" />}

              {/* Services Section */}
              {expandedSection === 'services' && connector && (
                <div className="space-y-2">
                  {connector.services.map((service) => (
                    <div
                      key={service.toolName}
                      className="flex items-center gap-3 p-3 bg-secondary/20 border border-primary/15 rounded-xl"
                    >
                      <Wrench className="w-3.5 h-3.5 text-muted-foreground/80" />
                      <div>
                        <span className="text-sm text-foreground/80">{service.label}</span>
                        <span className="ml-2 text-sm font-mono text-muted-foreground/60">{service.toolName}</span>
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

              {/* Intelligence Section */}
              {expandedSection === 'intelligence' && (
                <CredentialIntelligence credentialId={credential.id} />
              )}

              {/* Rotation Section */}
              {expandedSection === 'rotation' && (
                <div className="space-y-3">
                  {/* Anomaly Warning */}
                  {rotationStatus?.anomaly_detected && (
                    <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-400">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>Anomaly detected: credential suddenly failing after previous success. Possible revocation.</span>
                    </div>
                  )}

                  {/* Rotation Status Summary */}
                  {rotationStatus?.has_policy ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className={`w-4 h-4 ${rotationStatus.policy_enabled ? 'text-cyan-400' : 'text-muted-foreground/80'}`} />
                          <div className="text-sm">
                            <span className={rotationStatus.policy_enabled ? 'text-cyan-400 font-medium' : 'text-muted-foreground/90'}>
                              {rotationStatus.policy_enabled ? 'Auto-rotation active' : 'Rotation paused'}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {rotationCountdown && rotationStatus.policy_enabled && (
                            <span className="flex items-center gap-1 text-sm text-muted-foreground/90 font-mono">
                              <Clock className="w-3 h-3" />
                              {rotationCountdown}
                            </span>
                          )}
                          <button
                            onClick={async () => {
                              setIsRotating(true);
                              try {
                                await rotateCredentialNow(credential.id);
                                await fetchRotationStatus();
                                onHealthcheck(credential.id);
                              } catch {
                                // handled silently; rotation history records failures
                              } finally {
                                setIsRotating(false);
                              }
                            }}
                            disabled={isRotating}
                            className="flex items-center gap-1 px-2.5 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                          >
                            <RotateCw className={`w-3 h-3 ${isRotating ? 'animate-spin' : ''}`} />
                            Rotate Now
                          </button>
                          <button
                            onClick={async () => {
                              try {
                                const allPolicies = await api.listRotationPolicies(credential.id);
                                for (const p of allPolicies) {
                                  await deleteRotationPolicy(p.id);
                                }
                                await fetchRotationStatus();
                              } catch {
                                // silent
                              }
                            }}
                            className="p-1 hover:bg-red-500/10 rounded-lg transition-colors"
                            title="Remove rotation policy"
                          >
                            <Trash2 className="w-3 h-3 text-red-400/50" />
                          </button>
                        </div>
                      </div>

                      {/* Rotation period editor */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground/80">Rotate every</span>
                        {isEditingPeriod ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              value={rotationDays}
                              onChange={(e) => setRotationDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
                              min={1}
                              className="w-16 px-2 py-0.5 bg-background/50 border border-cyan-500/25 rounded-md text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
                            />
                            <span className="text-sm text-muted-foreground/80">days</span>
                            <button
                              onClick={async () => {
                                try {
                                  const allPolicies = await api.listRotationPolicies(credential.id);
                                  if (allPolicies.length > 0) {
                                    await updateRotationPolicy(allPolicies[0]!.id, { rotation_interval_days: rotationDays });
                                  }
                                  await fetchRotationStatus();
                                  setIsEditingPeriod(false);
                                } catch {
                                  // silent
                                }
                              }}
                              className="px-2 py-0.5 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/25 text-cyan-400 rounded-md text-sm font-medium transition-colors"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => {
                                setRotationDays(rotationStatus.rotation_interval_days ?? 90);
                                setIsEditingPeriod(false);
                              }}
                              className="px-2 py-0.5 text-muted-foreground/80 hover:text-foreground/90 text-sm transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setIsEditingPeriod(true)}
                            className="flex items-center gap-1 px-2 py-0.5 bg-secondary/40 hover:bg-secondary/60 border border-primary/15 rounded-md text-sm text-foreground/80 transition-colors"
                          >
                            <span className="font-mono">{rotationStatus.rotation_interval_days ?? 90}</span>
                            <span>days</span>
                            <Pencil className="w-2.5 h-2.5 text-muted-foreground/60 ml-0.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground/80">No rotation policy configured.</p>

                      {/* Period selection */}
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground/80">Rotate every</span>
                        <div className="flex items-center gap-1">
                          {[30, 60, 90, 180].map((d) => (
                            <button
                              key={d}
                              onClick={() => setRotationDays(d)}
                              className={`px-2 py-0.5 rounded-md text-sm font-mono transition-colors ${
                                rotationDays === d
                                  ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/25'
                                  : 'bg-secondary/40 text-muted-foreground/80 border border-transparent hover:bg-secondary/60'
                              }`}
                            >
                              {d}d
                            </button>
                          ))}
                          <input
                            type="number"
                            value={rotationDays}
                            onChange={(e) => setRotationDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
                            min={1}
                            className="w-16 px-2 py-0.5 bg-background/50 border border-primary/15 rounded-md text-sm text-foreground text-center focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
                          />
                          <span className="text-sm text-muted-foreground/60">days</span>
                        </div>
                      </div>

                      <button
                        onClick={async () => {
                          try {
                            await createRotationPolicy({
                              credential_id: credential.id,
                              rotation_interval_days: rotationDays,
                              policy_type: 'scheduled',
                              enabled: true,
                            });
                            await fetchRotationStatus();
                          } catch {
                            // silent
                          }
                        }}
                        className="flex items-center gap-1 px-2.5 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-400 rounded-lg text-sm font-medium transition-all"
                      >
                        <Plus className="w-3 h-3" />
                        Enable Rotation
                      </button>
                    </div>
                  )}

                  {/* Last Rotation Info */}
                  {rotationStatus?.last_rotated_at && (
                    <div className="text-sm text-muted-foreground/80">
                      Last rotated {formatRelativeTime(rotationStatus.last_rotated_at)}
                      {rotationStatus.last_status && (
                        <span className={`ml-1.5 ${
                          rotationStatus.last_status === 'success' ? 'text-emerald-400/60' : 'text-red-400/60'
                        }`}>
                          ({rotationStatus.last_status})
                        </span>
                      )}
                    </div>
                  )}

                  {/* Rotation History Timeline */}
                  {rotationStatus && rotationStatus.recent_history.length > 0 && (
                    <>
                      <div className="border-t border-primary/10" />
                      <div className="space-y-1.5">
                        <p className="text-sm text-muted-foreground/60 uppercase tracking-wider font-semibold">History</p>
                        <div className="space-y-1 max-h-[160px] overflow-y-auto">
                          {rotationStatus.recent_history.map((entry) => (
                            <div key={entry.id} className="flex items-start gap-2 text-sm">
                              <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${
                                entry.status === 'success' ? 'bg-emerald-400' :
                                entry.status === 'failed' ? 'bg-red-400' :
                                'bg-amber-400/60'
                              }`} />
                              <div className="flex-1 min-w-0">
                                <span className="text-muted-foreground/90 font-mono">{entry.rotation_type}</span>
                                {entry.detail && (
                                  <span className="text-muted-foreground/80 ml-1.5 truncate">{entry.detail}</span>
                                )}
                              </div>
                              <span className="text-muted-foreground/80 shrink-0">
                                {formatRelativeTime(entry.created_at)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
