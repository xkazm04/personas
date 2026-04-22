import { CredentialEditForm } from '@/features/vault/sub_credentials/components/forms/CredentialEditForm';
import { Button } from '@/features/shared/components/buttons';
import type { ConnectorDefinition, CredentialTemplateField } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';

interface AuthVariant {
  id: string;
  label: string;
  fields: string[];
  auth_type_label: string;
}

interface TemplateFormBodyProps {
  selectedConnector: ConnectorDefinition;
  credentialName: string;
  onCredentialNameChange: (name: string) => void;
  variantFields: CredentialTemplateField[];
  variants: AuthVariant[] | null;
  activeVariantId: string | null;
  onVariantChange: (id: string) => void;
  isAnyOAuth: boolean;
  isAuthorizingOAuth: boolean;
  oauthCompletedAt: string | null;
  oauthValues?: Record<string, string>;
  oauthConsentLabel?: string;
  oauthPollingMessage?: { success: boolean; message: string } | null;
  onCreateCredential: (values: Record<string, string>) => void;
  onOAuthConsent: (values: Record<string, string>) => void;
  onCancel: () => void;
  onValuesChanged: (key: string, value: string) => void;
  saveDisabled: boolean;
  saveDisabledReason?: string;
  onHealthcheck?: (values: Record<string, string>) => void;
  isHealthchecking?: boolean;
  healthcheckResult?: { success: boolean; message: string } | null;
}

export function TemplateFormBody({
  selectedConnector,
  credentialName,
  onCredentialNameChange,
  variantFields,
  variants,
  activeVariantId,
  onVariantChange,
  isAnyOAuth,
  isAuthorizingOAuth,
  oauthCompletedAt,
  oauthValues,
  oauthConsentLabel,
  oauthPollingMessage,
  onCreateCredential,
  onOAuthConsent,
  onCancel,
  onValuesChanged,
  saveDisabled,
  saveDisabledReason,
  onHealthcheck,
  isHealthchecking,
  healthcheckResult,
}: TemplateFormBodyProps) {
  const { t, tx } = useTranslation();
  const cf = t.vault.forms;
  const label = selectedConnector.label;

  // CONN-04: Zero-config empty-state for builtin connectors with no credential fields.
  // Triggers when (a) the selected auth variant exposes no fields AND
  // (b) the connector's metadata declares auth_type "none" or "builtin".
  // The CTA calls onCancel (not onCreateCredential) because the credential row
  // for builtin connectors is already seeded by seed_builtin_credentials on every
  // boot (see 18-RESEARCH.md §CONN-02 + T-18-01). Calling onCreateCredential({})
  // here would either duplicate the row or error on unique-id violation.
  const authType = (selectedConnector.metadata as Record<string, unknown> | null)?.auth_type;
  const isZeroConfig =
    variantFields.length === 0 && (authType === 'none' || authType === 'builtin');

  if (isZeroConfig) {
    return (
      <div className="space-y-4">
        <div className="rounded-modal border border-primary/8 bg-secondary/20 p-4 space-y-2">
          <p className="typo-body font-medium text-foreground">
            {cf.no_config_required_heading}
          </p>
          <p className="typo-body text-foreground/70">
            {cf.no_config_required_description}
          </p>
        </div>
        <div className="flex justify-end pt-2">
          <Button variant="primary" size="sm" onClick={onCancel}>
            {cf.no_config_required_dismiss}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div>
        <label className="block typo-body font-medium text-foreground mb-1.5">
          {cf.credential_name}
        </label>
        <input
          type="text"
          value={credentialName}
          onChange={(e) => onCredentialNameChange(e.target.value)}
          placeholder={tx(cf.credential_name_placeholder, { label })}
          className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-modal text-foreground typo-body placeholder-muted-foreground/30 focus-ring focus-visible:border-primary/40 transition-all"
        />
      </div>

      {variants && variants.length > 1 && (
        <div className="flex gap-1.5 p-1 bg-secondary/15 border border-primary/8 rounded-card">
          {variants.map((v) => (
            <Button
              key={v.id}
              variant="ghost"
              size="sm"
              onClick={() => onVariantChange(v.id)}
              className={activeVariantId === v.id
                ? 'bg-primary/10 text-primary border border-primary/20'
                : 'text-foreground hover:bg-secondary/40 border border-transparent'}
            >
              {v.label}
            </Button>
          ))}
        </div>
      )}

      <CredentialEditForm
        fields={variantFields}
        initialValues={oauthValues}
        onSave={onCreateCredential}
        onOAuthConsent={isAnyOAuth ? onOAuthConsent : undefined}
        oauthConsentLabel={isAuthorizingOAuth
          ? tx(cf.authorizing_with, { label })
          : (oauthConsentLabel ?? tx(cf.authorize_with, { label }))}
        oauthConsentDisabled={isAuthorizingOAuth}
        isAuthorizingOAuth={isAuthorizingOAuth}
        oauthPollingMessage={oauthPollingMessage}
        oauthConsentHint={isAnyOAuth
          ? tx(cf.oauth_consent_hint, { label })
          : undefined}
        oauthConsentSuccessBadge={oauthCompletedAt ? tx(cf.oauth_connected_at, { label, time: oauthCompletedAt }) : undefined}
        saveDisabled={saveDisabled}
        saveDisabledReason={saveDisabledReason}
        onHealthcheck={onHealthcheck}
        isHealthchecking={isHealthchecking}
        healthcheckResult={healthcheckResult}
        onValuesChanged={onValuesChanged}
        onCancel={onCancel}
      />
    </>
  );
}
