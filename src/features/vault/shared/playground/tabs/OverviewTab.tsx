import { useState } from 'react';
import { Key, Pencil } from 'lucide-react';
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
import { HealthProbeBanner } from './HealthProbeBanner';
import { BoundAccountChip } from '@/features/vault/shared/BoundAccountChip';
import { readCredentialAccount } from '@/features/vault/shared/credentialAccount';
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
  const boundAccount = readCredentialAccount(credential.metadata).email;

  const updateCredential = useVaultStore((s) => s.updateCredential);
  // Picker dispatch — modal is rendered by global <ResourcePickerHost />.
  const { promptIfScoped } = usePostSaveResourcePicker();

  return (
    <div className="p-6 space-y-6">
      {editError && (
        <VaultErrorBanner message={editError} onDismiss={() => setEditError(null)} variant="inline" />
      )}

      {isEditing ? (
        <>
          <p className="typo-caption text-muted-foreground -mb-2">
            Leave a field blank to keep its current saved value. Only fields you
            fill in are updated; hidden tokens and untouched secrets are preserved.
          </p>
          {/* Sits directly above the form's Authorize button: re-consent is
              bound to THIS account, and a different one is refused. */}
          {isGoogleOAuthFlow && boundAccount && (
            <div className="flex items-center gap-2 -mb-2">
              <BoundAccountChip email={boundAccount} />
              <span className="typo-caption text-foreground">{sh.bound_account_reauth_hint}</span>
            </div>
          )}
        <CredentialEditForm
          initialValues={googleOAuth.getValues()}
          fields={connector.fields}
          onSave={async (values) => {
            try {
              setEditError(null);
              // Only submit fields the user actually filled in. The form never
              // loads decrypted stored secrets, so a blank input is "unknown",
              // not "cleared" — sending it would blank a good secret. The backend
              // merges (upserts) these; omitted fields (incl. hidden OAuth tokens)
              // are left intact.
              const changed = Object.fromEntries(
                Object.entries(values).filter(
                  ([, v]) => typeof v === 'string' && v.trim() !== '',
                ),
              );
              await updateCredential(credential.id, { data: changed });
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
        </>
      ) : (
        <>
          {/* Primary actions */}
          <div className="flex items-center gap-2">
            <Button
              onClick={() => health.checkStored()}
              disabled={isHealthchecking}
              loading={isHealthchecking}
              variant="accent"
              tone="success"
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
            <BoundAccountChip email={boundAccount} />
          </div>

          {/* Healthcheck result -- three outcomes, not two. A probe that could
              not be reached is neutral evidence, not a rejected key. */}
          {effectiveHealthcheckResult && (
            <HealthProbeBanner
              result={effectiveHealthcheckResult}
              onRetry={() => health.checkStored()}
              isRetrying={isHealthchecking}
            />
          )}

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
