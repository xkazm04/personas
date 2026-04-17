import { useState } from 'react';
import { CredentialEditForm } from '@/features/vault/sub_credentials/components/forms/CredentialEditForm';
import { CredentialCardDetails } from '@/features/vault/sub_credentials/components/card/CredentialCardDetails';
import { VaultErrorBanner } from '@/features/vault/sub_credentials/components/card/banners/VaultErrorBanner';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import { useVaultStore } from "@/stores/vaultStore";
import type { RotationStatus } from '@/api/vault/rotation';
import type { HealthResult } from '@/features/vault/shared/hooks/health/useCredentialHealth';
import type { GoogleOAuthState } from '@/features/vault/shared/hooks/useGoogleOAuth';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t, tx } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const updateCredential = useVaultStore((s) => s.updateCredential);

  if (!connector) {
    return (
      <div className="px-3 pb-3 border-t border-primary/10">
        <div className="text-sm text-foreground py-3">
          {t.vault.credential_card.no_connector}
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
                setEditError(err instanceof Error ? err.message : t.vault.card_body.failed_update);
              }
            }}
            onOAuthConsent={isGoogleOAuthFlow ? onOAuthConsent : undefined}
            oauthConsentLabel={googleOAuth.isAuthorizing ? tx(t.vault.card_body.authorizing_with, { name: 'Google' }) : tx(t.vault.card_body.authorize_with, { name: 'Google' })}
            oauthConsentDisabled={googleOAuth.isAuthorizing}
            oauthConsentHint={isGoogleOAuthFlow ? tx(t.vault.card_body.authorize_hint, { name: 'Google' }) : undefined}
            oauthConsentSuccessBadge={googleOAuth.completedAt ? tx(t.vault.card_body.consent_completed, { name: 'Google', time: googleOAuth.completedAt }) : undefined}
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
