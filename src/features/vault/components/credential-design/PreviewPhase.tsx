import { motion } from 'framer-motion';
import { Plug, CheckCircle, ExternalLink, Shield, ListChecks, KeyRound, CircleHelp } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
import type { CredentialTemplateField } from '@/lib/types/types';
import { openExternalUrl } from '@/api/tauriApi';
import type { CredentialDesignResult } from '@/hooks/design/useCredentialDesign';

interface PreviewPhaseProps {
  result: CredentialDesignResult;
  credentialName: string;
  onCredentialNameChange: (name: string) => void;
  fields: CredentialTemplateField[];
  effectiveFields: CredentialTemplateField[];
  requiredCount: number;
  optionalCount: number;
  firstSetupUrl: string | null;
  isGoogleOAuthFlow: boolean;
  oauthInitialValues: Record<string, string>;
  isAuthorizingOAuth: boolean;
  oauthConsentCompletedAt: string | null;
  isHealthchecking: boolean;
  healthcheckResult: { success: boolean; message: string } | null;
  canSaveCredential: boolean;
  lastSuccessfulTestAt: string | null;
  onSave: (values: Record<string, string>) => void;
  onOAuthConsent?: (values: Record<string, string>) => void;
  onHealthcheck: (values: Record<string, string>) => void;
  onValuesChanged: (key: string, value: string) => void;
  onReset: () => void;
}

export function PreviewPhase({
  result,
  credentialName,
  onCredentialNameChange,
  fields,
  effectiveFields,
  requiredCount,
  optionalCount,
  firstSetupUrl,
  isGoogleOAuthFlow,
  oauthInitialValues,
  isAuthorizingOAuth,
  oauthConsentCompletedAt,
  isHealthchecking,
  healthcheckResult,
  canSaveCredential,
  lastSuccessfulTestAt,
  onSave,
  onOAuthConsent,
  onHealthcheck,
  onValuesChanged,
  onReset,
}: PreviewPhaseProps) {
  return (
    <motion.div
      key="preview"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-5"
    >
      {/* Match existing banner */}
      {result.match_existing && (
        <div className="flex items-start gap-3 px-4 py-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
          <Plug className="w-4 h-4 mt-0.5 text-blue-400 shrink-0" />
          <div className="text-sm">
            <span className="text-blue-300 font-medium">Existing connector found: </span>
            <span className="text-blue-400">{result.match_existing}</span>
            <p className="text-blue-300/60 text-xs mt-1">
              Your credential will be linked to the existing connector definition.
            </p>
          </div>
        </div>
      )}

      {/* Connector preview */}
      <div className="flex items-center gap-3 px-4 py-3 bg-secondary/40 border border-primary/10 rounded-xl">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center border"
          style={{
            backgroundColor: `${result.connector.color}15`,
            borderColor: `${result.connector.color}30`,
          }}
        >
          <Plug className="w-5 h-5" style={{ color: result.connector.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-foreground text-sm">{result.connector.label}</h4>
          <p className="text-xs text-muted-foreground/80">{result.summary}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 border border-primary/10 text-[11px] text-foreground/85">
            <ListChecks className="w-3 h-3" />
            {fields.length}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 border border-primary/10 text-[11px] text-foreground/85">
            <KeyRound className="w-3 h-3" />
            {requiredCount}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 border border-primary/10 text-[11px] text-foreground/85">
            <CircleHelp className="w-3 h-3" />
            {optionalCount}
          </span>
        </div>
        <span className="px-2 py-0.5 bg-primary/10 text-primary/70 text-xs rounded-md font-mono">
          {result.connector.category}
        </span>
      </div>

      {/* Setup instructions */}
      {result.setup_instructions && (
        <details className="group rounded-xl border border-primary/10 bg-secondary/20 px-4 py-3">
          <summary className="cursor-pointer text-xs text-foreground/85 hover:text-foreground transition-colors font-medium">
            Setup instructions
          </summary>
          <div className="mt-3 px-4 py-3 bg-background/40 rounded-xl border border-primary/10">
            <div className="prose prose-invert prose-sm max-w-none text-foreground/90 prose-p:my-1.5 prose-headings:my-2 prose-li:my-0.5 prose-strong:text-foreground prose-code:text-amber-300">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {result.setup_instructions}
              </ReactMarkdown>
            </div>
          </div>
          {firstSetupUrl && (
            <div className="mt-2">
              <button
                onClick={async () => {
                  try {
                    await openExternalUrl(firstSetupUrl);
                  } catch {
                    window.open(firstSetupUrl, '_blank', 'noopener,noreferrer');
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-primary/20 text-foreground/90 hover:bg-secondary/50 transition-colors"
              >
                Open setup page
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          )}
        </details>
      )}

      {/* Credential name */}
      <div>
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">
          Credential Name
        </label>
        <input
          type="text"
          value={credentialName}
          onChange={(e) => onCredentialNameChange(e.target.value)}
          placeholder={`${result.connector.label} Credential`}
          className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground text-sm placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
        />
      </div>

      {/* Credential fields form */}
      <div className="flex items-start gap-2.5 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
        <Shield className="w-4 h-4 text-emerald-300 mt-0.5 shrink-0" />
        <p className="text-xs text-emerald-200/80">
          Credentials are stored securely in the app vault and are available for agent tool execution.
        </p>
      </div>

      <CredentialEditForm
        initialValues={oauthInitialValues}
        fields={effectiveFields}
        onSave={onSave}
        onOAuthConsent={isGoogleOAuthFlow ? onOAuthConsent : undefined}
        oauthConsentLabel={isAuthorizingOAuth ? 'Authorizing with Google...' : 'Authorize with Google'}
        oauthConsentDisabled={isAuthorizingOAuth}
        oauthConsentHint={isGoogleOAuthFlow
          ? 'One click consent using app-managed Google OAuth. You can uncheck permissions on the consent screen.'
          : undefined}
        oauthConsentSuccessBadge={oauthConsentCompletedAt ? `Google consent completed at ${oauthConsentCompletedAt}` : undefined}
        onHealthcheck={onHealthcheck}
        testHint="Run Test Connection to let Claude choose the best endpoint for this service and verify your entered credentials dynamically."
        onValuesChanged={onValuesChanged}
        isHealthchecking={isHealthchecking}
        healthcheckResult={healthcheckResult}
        saveDisabled={!canSaveCredential}
        saveDisabledReason={isGoogleOAuthFlow
          ? 'Save is unlocked after Google consent returns a refresh token.'
          : 'Save is locked until Test Connection succeeds for the current credential values.'}
        onCancel={onReset}
      />

      {canSaveCredential && lastSuccessfulTestAt && (
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-xs">
          <CheckCircle className="w-3.5 h-3.5" />
          Tested successfully at {lastSuccessfulTestAt}
        </div>
      )}
    </motion.div>
  );
}
