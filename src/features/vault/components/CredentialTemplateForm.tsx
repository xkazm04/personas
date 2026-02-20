import { Plug } from 'lucide-react';
import { motion } from 'framer-motion';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
import type { ConnectorDefinition, CredentialTemplateField } from '@/lib/types/types';

export interface CredentialTemplateFormProps {
  selectedConnector: ConnectorDefinition;
  credentialName: string;
  onCredentialNameChange: (name: string) => void;
  effectiveTemplateFields: CredentialTemplateField[];
  isGoogleTemplate: boolean;
  isAuthorizingOAuth: boolean;
  oauthCompletedAt: string | null;
  onCreateCredential: (values: Record<string, string>) => void;
  onOAuthConsent: (values: Record<string, string>) => void;
  onCancel: () => void;
  onValuesChanged: () => void;
}

export function CredentialTemplateForm({
  selectedConnector,
  credentialName,
  onCredentialNameChange,
  effectiveTemplateFields,
  isGoogleTemplate,
  isAuthorizingOAuth,
  oauthCompletedAt,
  onCreateCredential,
  onOAuthConsent,
  onCancel,
  onValuesChanged,
}: CredentialTemplateFormProps) {
  return (
    <motion.div
      key="form"
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-2xl p-6 space-y-4"
    >
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center border"
          style={{
            backgroundColor: `${selectedConnector.color}15`,
            borderColor: `${selectedConnector.color}30`,
          }}
        >
          {selectedConnector.icon_url ? (
            <img src={selectedConnector.icon_url} alt={selectedConnector.label} className="w-5 h-5" />
          ) : (
            <Plug className="w-5 h-5" style={{ color: selectedConnector.color }} />
          )}
        </div>
        <div>
          <h4 className="font-medium text-foreground">New {selectedConnector.label} Credential</h4>
          <p className="text-xs text-muted-foreground/40">
            {selectedConnector.healthcheck_config?.description || 'Configure credential fields'}
          </p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">
          Credential Name
        </label>
        <input
          type="text"
          value={credentialName}
          onChange={(e) => onCredentialNameChange(e.target.value)}
          placeholder={`My ${selectedConnector.label} Account`}
          className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground text-sm placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
        />
      </div>

      <CredentialEditForm
        fields={effectiveTemplateFields}
        onSave={onCreateCredential}
        onOAuthConsent={isGoogleTemplate ? onOAuthConsent : undefined}
        oauthConsentLabel={isAuthorizingOAuth ? 'Authorizing with Google...' : 'Authorize with Google'}
        oauthConsentDisabled={isAuthorizingOAuth}
        oauthConsentHint={isGoogleTemplate
          ? 'One click consent: uses app-managed Google OAuth and saves token metadata in background.'
          : undefined}
        oauthConsentSuccessBadge={oauthCompletedAt ? `Google consent completed at ${oauthCompletedAt}` : undefined}
        saveDisabled={isGoogleTemplate}
        saveDisabledReason={isGoogleTemplate ? 'Use Authorize with Google to create this credential.' : undefined}
        onValuesChanged={onValuesChanged}
        onCancel={onCancel}
      />
    </motion.div>
  );
}
