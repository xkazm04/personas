import { useState } from 'react';
import { Plug, CheckCircle, Shield, ListChecks, KeyRound, CircleHelp, Bot, PenLine, PackagePlus } from 'lucide-react';
import { CredentialEditForm } from '@/features/vault/sub_forms/CredentialEditForm';
import { NegotiatorPanel } from '@/features/vault/sub_negotiator/NegotiatorPanel';
import { VaultErrorBanner } from '@/features/vault/sub_card/banners/VaultErrorBanner';
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

const INFO_STATUS = STATUS_COLORS.info!;
const AI_STATUS = STATUS_COLORS.ai!;
const SUCCESS_STATUS = STATUS_COLORS.success!;

export function PreviewPhase() {
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
  } = useCredentialDesignContext();

  const [showNegotiator, setShowNegotiator] = useState(false);

  const providerLabel = getProviderLabel(credentialFlow);

  return (
    <div
      key="preview"
      className="animate-fade-slide-in space-y-4"
    >
      {/* Save error banner */}
      {saveError && (
        <VaultErrorBanner message={saveError} variant="banner" />
      )}

      {/* Match existing banner */}
      {result.match_existing && (
        <div className={`flex items-start gap-3 px-4 py-3 border rounded-xl ${INFO_STATUS.bg} ${INFO_STATUS.border}`}>
          <Plug className={`w-4 h-4 mt-0.5 shrink-0 ${INFO_STATUS.text}`} />
          <div className="text-sm">
            <span className={`${INFO_STATUS.text} font-medium`}>Existing connector found: </span>
            <span className={INFO_STATUS.text}>{result.match_existing}</span>
            <p className="text-foreground/70 text-sm mt-1">
              Your credential will be linked to the existing connector definition.
            </p>
          </div>
        </div>
      )}

      {/* New connector discovery banner */}
      {!result.match_existing && (
        <div className={`flex items-start gap-3 px-4 py-3 border rounded-xl ${AI_STATUS.bg} ${AI_STATUS.border}`}>
          <PackagePlus className={`w-4 h-4 mt-0.5 shrink-0 ${AI_STATUS.text}`} />
          <div className="text-sm">
            <span className={`${AI_STATUS.text} font-medium`}>New connector discovered </span>
            <span className="text-foreground/80">
              -- no existing <span className="font-mono text-foreground/90">{result.connector.name}</span> connector was found in your catalog.
            </span>
            <p className="text-foreground/70 text-sm mt-1">
              When you save this credential, the AI-generated connector definition will be
              automatically registered in your connector catalog -- making it reusable for
              other personas and template adoption.
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
          <p className="text-sm text-muted-foreground/80">{result.summary}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary/50 border border-primary/10 text-sm text-foreground/85">
            <ListChecks className="w-3 h-3" />
            {fields.length}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary/50 border border-primary/10 text-sm text-foreground/85">
            <KeyRound className="w-3 h-3" />
            {requiredCount}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-secondary/50 border border-primary/10 text-sm text-foreground/85">
            <CircleHelp className="w-3 h-3" />
            {optionalCount}
          </span>
        </div>
        <span className="px-2 py-0.5 bg-primary/10 text-primary/70 text-sm rounded-lg font-mono">
          {result.connector.category}
        </span>
      </div>

      {/* Refine request */}
      {onRefine && (
        <button
          onClick={onRefine}
          className="flex items-center gap-1.5 text-sm text-muted-foreground/90 hover:text-primary/70 transition-colors"
        >
          <PenLine className="w-3 h-3" />
          Not quite right? Refine your request
        </button>
      )}

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
              className={`animate-fade-slide-in flex items-center gap-3 px-4 py-3 rounded-xl border ${AI_STATUS.bg} ${AI_STATUS.border}`}
            >
              <Bot className={`w-4 h-4 shrink-0 ${AI_STATUS.text}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground/90">
                  <span className={`${AI_STATUS.text} font-medium`}>Auto-provision available</span>{' '}
                  -- let AI guide you through obtaining your {result.connector.label} credentials step-by-step.
                </p>
              </div>
              <button
                onClick={() => setShowNegotiator(true)}
                className={`shrink-0 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${AI_STATUS.bg} ${AI_STATUS.border} ${AI_STATUS.text} hover:opacity-90`}
              >
                Start
              </button>
            </div>
          ) : (
            <NegotiatorPanel
              key="neg-panel"
              designResult={result}
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
        <label className="block text-sm font-medium text-foreground/80 mb-1.5">
          Credential Name
        </label>
        <input
          type="text"
          value={credentialName}
          onChange={(e) => onCredentialNameChange(e.target.value)}
          placeholder={`${result.connector.label} Credential`}
          className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground text-sm placeholder-muted-foreground/30 focus-ring focus-visible:border-primary/40 transition-all"
        />
      </div>

      {/* Credential fields form */}
      <div className={`flex items-start gap-2.5 px-3 py-2 rounded-xl border ${SUCCESS_STATUS.bg} ${SUCCESS_STATUS.border}`}>
        <Shield className={`w-4 h-4 mt-0.5 shrink-0 ${SUCCESS_STATUS.text}`} />
        <p className="text-sm text-foreground/80">
          Credentials are stored securely in the app vault and are available for agent tool execution.
        </p>
      </div>

      {oauthStatusMessage && !oauthStatusMessage.success && (
        <div className="text-sm px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
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
