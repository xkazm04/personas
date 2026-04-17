import { useState } from 'react';
import { CheckCircle, Shield, Bot } from 'lucide-react';
import { CredentialEditForm } from '@/features/vault/sub_credentials/components/forms/CredentialEditForm';
import { NegotiatorPanel } from '@/features/vault/sub_catalog/components/negotiator/NegotiatorPanel';
import { VaultErrorBanner } from '@/features/vault/sub_credentials/components/card/banners/VaultErrorBanner';
import { STATUS_COLORS } from '@/lib/utils/designTokens';
import { InteractiveSetupInstructions } from '../setup/InteractiveSetupInstructions';
import { useCredentialDesignContext } from '../CredentialDesignContext';
import {
  isOAuthFlow,
  showsHealthcheck,
  showsNegotiator,
  getProviderLabel,
  getOAuthConsentHint,
  getSaveDisabledReason,
} from '../CredentialDesignHelpers';
import { PreviewBanners } from './PreviewBanners';
import { useTranslation } from '@/i18n/useTranslation';

const AI_STATUS = STATUS_COLORS.ai!;
const SUCCESS_STATUS = STATUS_COLORS.success!;

export function PreviewPhase() {
  const { t } = useTranslation();
  const {
    result,
    credentialName,
    onCredentialNameChange,
    fields,
    effectiveFields,
    requiredCount,
    optionalCount,
    firstSetupUrl,
    credentialFlow,
    oauthInitialValues,
    isAuthorizingOAuth,
    oauthConsentCompletedAt,
    isHealthchecking,
    healthcheckResult,
    oauthStatusMessage,
    canSaveCredential,
    isSaving,
    lastSuccessfulTestAt,
    onSave,
    onOAuthConsent,
    onHealthcheck,
    onValuesChanged,
    saveError,
    onReset,
    onRefine,
    onNegotiatorValues,
    prefetchedAuthDetections,
  } = useCredentialDesignContext();

  const [showNegotiator, setShowNegotiator] = useState(false);

  const providerLabel = getProviderLabel(credentialFlow);

  return (
    <div
      key="preview"
      className="animate-fade-slide-in space-y-4"
    >
      {saveError && <VaultErrorBanner message={saveError} variant="banner" />}

      <PreviewBanners
        result={result}
        fields={fields}
        requiredCount={requiredCount}
        optionalCount={optionalCount}
        onRefine={onRefine}
      />

      {/* Setup instructions */}
      {result.setup_instructions && (
        <InteractiveSetupInstructions
          markdown={result.setup_instructions}
          firstSetupUrl={firstSetupUrl}
        />
      )}

      {/* AI Auto-Provision */}
      {showsNegotiator(credentialFlow) && (
        <>
          {!showNegotiator ? (
            <div
              key="neg-trigger"
              className={`animate-fade-slide-in flex items-center gap-3 px-4 py-3 rounded-modal border ${AI_STATUS.bg} ${AI_STATUS.border}`}
            >
              <Bot className={`w-4 h-4 shrink-0 ${AI_STATUS.text}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground/90">
                  <span className={`${AI_STATUS.text} font-medium`}>{t.vault.design_phases.auto_provision}</span>{' '}
                  -- let AI guide you through obtaining your {result.connector.label} credentials step-by-step.
                </p>
              </div>
              <button
                onClick={() => setShowNegotiator(true)}
                className={`shrink-0 px-3 py-1.5 rounded-modal text-sm font-medium transition-colors ${AI_STATUS.bg} ${AI_STATUS.border} ${AI_STATUS.text} hover:opacity-90`}
              >
                Start
              </button>
            </div>
          ) : (
            <NegotiatorPanel
              key="neg-panel"
              designResult={result}
              prefetchedAuthDetections={prefetchedAuthDetections}
              onComplete={(values) => {
                setShowNegotiator(false);
                if (onNegotiatorValues) {
                  onNegotiatorValues(values);
                }
              }}
              onClose={() => setShowNegotiator(false)}
            />
          )}
        </>
      )}

      {/* Credential name */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">
          Credential Name
        </label>
        <input
          type="text"
          value={credentialName}
          onChange={(e) => onCredentialNameChange(e.target.value)}
          placeholder={`${result.connector.label} Credential`}
          className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-modal text-foreground text-sm placeholder-muted-foreground/30 focus-ring focus-visible:border-primary/40 transition-all"
        />
      </div>

      {/* Security notice */}
      <div className={`flex items-start gap-2.5 px-3 py-2 rounded-modal border ${SUCCESS_STATUS.bg} ${SUCCESS_STATUS.border}`}>
        <Shield className={`w-4 h-4 mt-0.5 shrink-0 ${SUCCESS_STATUS.text}`} />
        <p className="text-sm text-foreground">
          Credentials are stored securely in the app vault and are available for agent tool execution.
        </p>
      </div>

      {oauthStatusMessage && !oauthStatusMessage.success && (
        <div className="text-sm px-3 py-2 rounded-card bg-red-500/10 border border-red-500/20 text-red-400">
          {oauthStatusMessage.message}
        </div>
      )}

      <CredentialEditForm
        initialValues={oauthInitialValues}
        fields={effectiveFields}
        onSave={onSave}
        onOAuthConsent={isOAuthFlow(credentialFlow) ? onOAuthConsent : undefined}
        oauthConsentLabel={isAuthorizingOAuth
          ? `Authorizing with ${providerLabel}...`
          : `Authorize with ${providerLabel}`}
        oauthConsentDisabled={isAuthorizingOAuth}
        isAuthorizingOAuth={isAuthorizingOAuth}
        oauthPollingMessage={oauthStatusMessage}
        oauthConsentHint={getOAuthConsentHint(credentialFlow)}
        oauthConsentSuccessBadge={oauthConsentCompletedAt
          ? `${providerLabel} consent completed at ${oauthConsentCompletedAt}`
          : undefined}
        onHealthcheck={showsHealthcheck(credentialFlow) ? onHealthcheck : undefined}
        testHint="Run Test Connection to let Claude choose the best endpoint for this service and verify your entered credentials dynamically."
        onValuesChanged={onValuesChanged}
        isHealthchecking={isHealthchecking}
        healthcheckResult={healthcheckResult}
        isSaving={isSaving}
        saveDisabled={!canSaveCredential || isSaving}
        saveDisabledReason={getSaveDisabledReason(credentialFlow)}
        onCancel={onReset}
      />

      {canSaveCredential && lastSuccessfulTestAt && (
        <div
          className={`animate-fade-slide-in inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-sm ${SUCCESS_STATUS.bg} ${SUCCESS_STATUS.border} ${SUCCESS_STATUS.text}`}
        >
          <CheckCircle className="w-3.5 h-3.5" />
          Tested successfully at {lastSuccessfulTestAt}
        </div>
      )}
    </div>
  );
}
