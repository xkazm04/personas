import { useState, useCallback, useRef, useEffect } from 'react';
import { Key, Pencil, Copy, Check } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { CredentialEditForm } from '@/features/vault/sub_credentials/components/forms/CredentialEditForm';
import { VaultErrorBanner } from '@/features/vault/sub_credentials/components/card/banners/VaultErrorBanner';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { useVaultStore } from "@/stores/vaultStore";
import type { RotationStatus } from '@/api/vault/rotation';
import type { HealthResult } from '@/features/vault/shared/hooks/health/useCredentialHealth';
import type { GoogleOAuthState } from '@/features/vault/shared/hooks/useGoogleOAuth';
import { OverviewSections } from './OverviewSections';
import { usePostSaveResourcePicker } from '@/features/vault/sub_credentials/components/picker/usePostSaveResourcePicker';

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
  const { t } = useTranslation();
  const sh = t.vault.shared;
  const [isEditing, setIsEditing] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateCredential = useVaultStore((s) => s.updateCredential);
  // Picker dispatch — modal is rendered by global <ResourcePickerHost />.
  const { promptIfScoped } = usePostSaveResourcePicker();

  const copyCredentialId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(credential.id);
      setCopiedId(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopiedId(false), 1500);
    } catch { /* intentional: non-critical -- clipboard copy may be denied by browser */ }
  }, [credential.id]);

  useEffect(() => {
    return () => { if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current); };
  }, []);

  return (
    <div className="p-6 space-y-6">
      {editError && (
        <VaultErrorBanner message={editError} onDismiss={() => setEditError(null)} variant="inline" />
      )}

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
              // Open the resource picker if the connector declares any.
              // promptIfScoped is a no-op when there are no resources;
              // list errors surface inline in the picker, so we don't
              // gate behind a pre-save healthcheck.
              await promptIfScoped({
                credentialId: credential.id,
                serviceType: credential.service_type,
              });
            } catch (err) {
              setEditError(err instanceof Error ? err.message : sh.failed_update);
            }
          }}
          onOAuthConsent={isGoogleOAuthFlow ? onOAuthConsent : undefined}
          oauthConsentLabel={googleOAuth.isAuthorizing ? 'Authorizing with Google...' : 'Authorize with Google'}
          oauthConsentDisabled={googleOAuth.isAuthorizing}
          oauthConsentHint={isGoogleOAuthFlow ? 'Launches app-managed Google consent and updates refresh token after approval.' : undefined}
          oauthConsentSuccessBadge={googleOAuth.completedAt ? `Google consent completed at ${googleOAuth.completedAt}` : undefined}
          isAuthorizingOAuth={googleOAuth.isAuthorizing}
          oauthPollingMessage={googleOAuth.message}
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
            <Button
              onClick={() => health.checkStored()}
              disabled={isHealthchecking}
              loading={isHealthchecking}
              variant="accent"
              accentColor="emerald"
              size="md"
              icon={!isHealthchecking ? <Key className="w-3.5 h-3.5" /> : undefined}
              className="min-h-[36px]"
            >
              {sh.test_connection}
            </Button>
            <Button
              onClick={() => setIsEditing(true)}
              variant="secondary"
              size="md"
              icon={<Pencil className="w-3.5 h-3.5" />}
              className="min-h-[36px]"
            >
              {sh.edit_fields}
            </Button>
          </div>

          {/* Healthcheck result */}
          {effectiveHealthcheckResult && (
            <div className={`flex items-start gap-2 px-4 py-3 rounded-modal typo-body ${
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
            <Button
              onClick={copyCredentialId}
              variant="ghost"
              size="xs"
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-primary/10 bg-secondary/20 text-foreground hover:text-foreground/80"
              title={t.vault.shared.copy_credential_id}
            >
              <span className="font-mono">id</span>
              {copiedId ? (
                <div><Check className="animate-fade-scale-in w-3.5 h-3.5 text-emerald-400" /></div>
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </Button>
          </div>

          <OverviewSections
            credential={credential}
            connector={connector}
            onDelete={onDelete}
          />
        </>
      )}
    </div>
  );
}
