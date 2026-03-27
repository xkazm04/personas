import { useState } from 'react';
import { CredentialEditForm } from '@/features/vault/sub_forms/CredentialEditForm';
import { CredentialCardDetails } from '@/features/vault/sub_card/CredentialCardDetails';
import { VaultErrorBanner } from '@/features/vault/sub_card/banners/VaultErrorBanner';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { useVaultStore } from "@/stores/vaultStore";
import type { RotationStatus } from '@/api/vault/rotation';
import type { HealthResult } from '@/features/vault/hooks/health/useCredentialHealth';
import type { GoogleOAuthState } from '@/features/vault/hooks/useGoogleOAuth';

export interface CredentialCardBodyProps {
  credential: CredentialMetadata;
  connector: ConnectorDefinition | undefined;
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
}

export function CredentialCardBody({
  credential,
  connector,
  isGoogleOAuthFlow,
  googleOAuth,
  effectiveHealthcheckResult,
  isHealthchecking,
  health,
  rotationStatus,
  rotationCountdown,
  fetchRotationStatus,
  editError,
  setEditError,
  onOAuthConsent,
}: CredentialCardBodyProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const updateCredential = useVaultStore((s) => s.updateCredential);

  if (!connector) {
    return (
      <div className="px-3 pb-3 border-t border-primary/10">
        <div className="text-sm text-muted-foreground/80 py-3">
          No connector definition available for this credential type.
        </div>
      </div>
    );
  }

  return (
    <div id={`cred-body-${credential.id}`} className="px-3 pb-3 border-t border-primary/10">
      <div className="pt-3 space-y-3">
        {editError && (
          <VaultErrorBanner message={editError} onDismiss={() => setEditError(null)} variant="inline" />
        )}
        {editingId === credential.id ? (
          <CredentialEditForm
            initialValues={googleOAuth.getValues()}
            fields={connector.fields}
            onSave={async (values) => {
              try {
                setEditError(null);
                await updateCredential(credential.id, { data: values });
                googleOAuth.reset();
                setEditingId(null);
              } catch (err) {
                setEditError(err instanceof Error ? err.message : 'Failed to update credential');
              }
            }}
            onOAuthConsent={isGoogleOAuthFlow ? onOAuthConsent : undefined}
            oauthConsentLabel={googleOAuth.isAuthorizing ? 'Authorizing with Google...' : 'Authorize with Google'}
            oauthConsentDisabled={googleOAuth.isAuthorizing}
            oauthConsentHint={isGoogleOAuthFlow ? 'Launches app-managed Google consent and updates refresh token after approval.' : undefined}
            oauthConsentSuccessBadge={googleOAuth.completedAt ? `Google consent completed at ${googleOAuth.completedAt}` : undefined}
            isAuthorizingOAuth={googleOAuth.isAuthorizing}
            oauthPollingMessage={googleOAuth.message}
            onCancel={() => setEditingId(null)}
            onHealthcheck={(values) => health.checkPreview(credential.service_type, values)}
            onValuesChanged={() => {
              if (googleOAuth.completedAt) {
                googleOAuth.reset();
              }
            }}
            isHealthchecking={isHealthchecking}
            healthcheckResult={effectiveHealthcheckResult}
          />
        ) : (
          <CredentialCardDetails
            credential={credential}
            connector={connector}
            effectiveHealthcheckResult={effectiveHealthcheckResult}
            isHealthchecking={isHealthchecking}
            health={health}
            rotationStatus={rotationStatus}
            rotationCountdown={rotationCountdown}
            fetchRotationStatus={fetchRotationStatus}
            onStartEditing={() => setEditingId(credential.id)}
          />
        )}
      </div>
    </div>
  );
}
