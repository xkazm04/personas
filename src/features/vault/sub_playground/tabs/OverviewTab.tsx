import { useState, useCallback, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Key, Wrench, Zap, Pencil, Copy, Check, ChevronDown, ChevronRight, Trash2 } from 'lucide-react';
import { CredentialEditForm } from '@/features/vault/sub_forms/CredentialEditForm';
import { CredentialEventConfig } from '@/features/vault/sub_features/CredentialEventConfig';
import { CredentialIntelligence } from '@/features/vault/sub_features/CredentialIntelligence';
import { VaultErrorBanner } from '@/features/vault/sub_card/VaultErrorBanner';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';
import type { RotationStatus } from '@/api/rotation';
import type { HealthResult } from '@/features/vault/hooks/useCredentialHealth';
import type { GoogleOAuthState } from '@/features/vault/hooks/useGoogleOAuth';

export interface OverviewTabProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition;
  isGoogleOAuthFlow: boolean;
  googleOAuth: GoogleOAuthState;
  effectiveHealthcheckResult: HealthResult | null;
  isHealthchecking: boolean;
  health: {
    checkStored: () => void;
    checkPreview: (serviceType: string, values: Record<string, string>) => void;
  };
  rotationStatus: RotationStatus | null;
  rotationCountdown: string | null;
  fetchRotationStatus: () => Promise<void>;
  editError: string | null;
  setEditError: (error: string | null) => void;
  onOAuthConsent: (values: Record<string, string>) => void;
  onDelete: (id: string) => void;
}

export function OverviewTab({
  credential,
  connector,
  isGoogleOAuthFlow,
  googleOAuth,
  effectiveHealthcheckResult,
  isHealthchecking,
  health,
  editError,
  setEditError,
  onOAuthConsent,
  onDelete,
}: OverviewTabProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [expandedSection, setExpandedSection] = useState<'services' | 'events' | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateCredential = usePersonaStore((s) => s.updateCredential);

  const copyCredentialId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(credential.id);
      setCopiedId(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedId(false), 1500);
    } catch { /* intentional: non-critical — clipboard copy may be denied by browser */ }
  }, [credential.id]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  return (
    <div className="p-6 space-y-6">
      {editError && (
        <VaultErrorBanner message={editError} onDismiss={() => setEditError(null)} variant="inline" />
      )}

      {/* Edit mode */}
      {isEditing ? (
        <CredentialEditForm
          initialValues={googleOAuth.getValues()}
          fields={connector.fields}
          onSave={async (values) => {
            try {
              setEditError(null);
              await updateCredential(credential.id, { data: values });
              googleOAuth.reset();
              setIsEditing(false);
            } catch (err) {
              setEditError(err instanceof Error ? err.message : 'Failed to update credential');
            }
          }}
          onOAuthConsent={isGoogleOAuthFlow ? onOAuthConsent : undefined}
          oauthConsentLabel={googleOAuth.isAuthorizing ? 'Authorizing with Google...' : 'Authorize with Google'}
          oauthConsentDisabled={googleOAuth.isAuthorizing}
          oauthConsentHint={isGoogleOAuthFlow ? 'Launches app-managed Google consent and updates refresh token after approval.' : undefined}
          oauthConsentSuccessBadge={googleOAuth.completedAt ? `Google consent completed at ${googleOAuth.completedAt}` : undefined}
          onCancel={() => setIsEditing(false)}
          onHealthcheck={(values) => health.checkPreview(credential.service_type, values)}
          onValuesChanged={() => { if (googleOAuth.completedAt) googleOAuth.reset(); }}
          isHealthchecking={isHealthchecking}
          healthcheckResult={effectiveHealthcheckResult}
        />
      ) : (
        <>
          {/* Primary actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => health.checkStored()}
              disabled={isHealthchecking}
              className="flex items-center gap-1.5 px-4 py-2 min-h-[36px] bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-400 rounded-xl text-sm font-medium transition-all disabled:opacity-50"
            >
              {isHealthchecking ? (
                <div className="w-3.5 h-3.5 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <Key className="w-3.5 h-3.5" />
              )}
              Test Connection
            </button>
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1.5 px-4 py-2 min-h-[36px] bg-secondary/60 hover:bg-secondary border border-primary/15 text-foreground/90 rounded-xl text-sm font-medium transition-all"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit Fields
            </button>
            <div className="ml-auto">
              {showDeleteConfirm ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-red-400/80">Delete this credential?</span>
                  <button
                    onClick={() => onDelete(credential.id)}
                    className="px-3 py-1.5 bg-red-500/15 hover:bg-red-500/25 border border-red-500/25 text-red-400 rounded-xl text-sm font-medium transition-all"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-3 py-1.5 bg-secondary/40 hover:bg-secondary/60 border border-primary/15 text-foreground/70 rounded-xl text-sm font-medium transition-all"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowDeleteConfirm(true)}
                  className="p-2 hover:bg-red-500/10 rounded-lg transition-colors"
                  title="Delete credential"
                >
                  <Trash2 className="w-4 h-4 text-red-400/50 hover:text-red-400/80" />
                </button>
              )}
            </div>
          </div>

          {/* Healthcheck result */}
          {effectiveHealthcheckResult && (
            <div className={`flex items-start gap-2 px-4 py-3 rounded-xl text-sm ${
              effectiveHealthcheckResult.success
                ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                : 'bg-red-500/10 border border-red-500/20 text-red-400'
            }`}>
              <span className="font-semibold shrink-0">{effectiveHealthcheckResult.success ? 'OK' : 'FAIL'}:</span>
              <span className="break-all">{effectiveHealthcheckResult.message}</span>
            </div>
          )}

          {/* Credential ID */}
          <div className="flex items-center">
            <button
              onClick={copyCredentialId}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-primary/10 bg-secondary/20 text-sm text-muted-foreground/70 hover:text-foreground/80 transition-colors"
              title="Copy credential ID"
            >
              <span className="font-mono">id</span>
              {copiedId ? (
                <motion.div initial={{ scale: 0.8 }} animate={{ scale: 1 }} transition={{ duration: 0.15 }}>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                </motion.div>
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {/* Collapsible sections: Services and Events */}
          {connector.services.length > 0 && (
            <div className="border border-primary/10 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandedSection(expandedSection === 'services' ? null : 'services')}
                className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-secondary/20 transition-colors"
              >
                <Wrench className="w-3.5 h-3.5 text-muted-foreground/60" />
                <span className="text-sm font-medium text-foreground/80">Services ({connector.services.length})</span>
                {expandedSection === 'services' ? (
                  <ChevronDown className="w-3.5 h-3.5 ml-auto text-muted-foreground/50" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 ml-auto text-muted-foreground/50" />
                )}
              </button>
              {expandedSection === 'services' && (
                <div className="px-4 pb-3 space-y-2">
                  {connector.services.map((service) => (
                    <div
                      key={service.toolName}
                      className="flex items-center gap-3 p-3 bg-secondary/20 border border-primary/10 rounded-xl border-l-2"
                      style={{ borderLeftColor: connector.color || 'transparent' }}
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
            </div>
          )}

          {connector.events.length > 0 && (
            <div className="border border-primary/10 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandedSection(expandedSection === 'events' ? null : 'events')}
                className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-secondary/20 transition-colors"
              >
                <Zap className="w-3.5 h-3.5 text-muted-foreground/60" />
                <span className="text-sm font-medium text-foreground/80">Events ({connector.events.length})</span>
                {expandedSection === 'events' ? (
                  <ChevronDown className="w-3.5 h-3.5 ml-auto text-muted-foreground/50" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 ml-auto text-muted-foreground/50" />
                )}
              </button>
              {expandedSection === 'events' && (
                <div className="px-4 pb-3">
                  <CredentialEventConfig credentialId={credential.id} events={connector.events} />
                </div>
              )}
            </div>
          )}
          {/* Intelligence */}
          <div className="border border-primary/10 rounded-xl p-4">
            <CredentialIntelligence credentialId={credential.id} />
          </div>
        </>
      )}
    </div>
  );
}
