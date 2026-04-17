import { CredentialEditForm } from '@/features/vault/sub_credentials/components/forms/CredentialEditForm';
import { Button } from '@/features/shared/components/buttons';
import type { ConnectorDefinition, CredentialTemplateField } from '@/lib/types/types';

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
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">
          Credential Name
        </label>
        <input
          type="text"
          value={credentialName}
          onChange={(e) => onCredentialNameChange(e.target.value)}
          placeholder={`Label this credential — e.g. My ${selectedConnector.label} Account, Production ${selectedConnector.label}`}
          className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-modal text-foreground text-sm placeholder-muted-foreground/30 focus-ring focus-visible:border-primary/40 transition-all"
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
                : 'text-muted-foreground/80 hover:bg-secondary/40 border border-transparent'}
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
          ? `Authorizing with ${selectedConnector.label}...`
          : (oauthConsentLabel ?? `Authorize with ${selectedConnector.label}`)}
        oauthConsentDisabled={isAuthorizingOAuth}
        isAuthorizingOAuth={isAuthorizingOAuth}
        oauthPollingMessage={oauthPollingMessage}
        oauthConsentHint={isAnyOAuth
          ? `Opens ${selectedConnector.label} in your browser. Grant access, then return here.`
          : undefined}
        oauthConsentSuccessBadge={oauthCompletedAt ? `${selectedConnector.label} connected at ${oauthCompletedAt}` : undefined}
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
