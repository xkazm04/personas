import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plug, CheckCircle, Shield, ListChecks, KeyRound, CircleHelp, Bot, PenLine } from 'lucide-react';
import { CredentialEditForm } from '@/features/vault/sub_forms/CredentialEditForm';
import { NegotiatorPanel } from '@/features/vault/sub_negotiator/NegotiatorPanel';
import { VaultErrorBanner } from '@/features/vault/sub_card/VaultErrorBanner';
import { STATUS_COLORS } from '@/lib/utils/designTokens';
import { InteractiveSetupInstructions } from './InteractiveSetupInstructions';
import { useCredentialDesignContext } from './CredentialDesignContext';
import {
  isOAuthFlow,
  showsHealthcheck,
  showsNegotiator,
  getProviderLabel,
  getOAuthConsentHint,
  getSaveDisabledReason,
} from './CredentialDesignHelpers';

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
    <motion.div
      key="preview"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      {/* Save error banner */}
      {saveError && (
        <VaultErrorBanner message={saveError} variant="banner" />
      )}

      {/* Match existing banner */}
      {result.match_existing && (
        <div className={`flex items-start gap-3 px-4 py-3 border rounded-xl ${INFO_STATUS.bgColor} ${INFO_STATUS.borderColor}`}>
          <Plug className={`w-4 h-4 mt-0.5 shrink-0 ${INFO_STATUS.color}`} />
          <div className="text-sm">
            <span className={`${INFO_STATUS.color} font-medium`}>Existing connector found: </span>
            <span className={INFO_STATUS.color}>{result.match_existing}</span>
            <p className="text-foreground/70 text-sm mt-1">
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
          <p className="text-sm text-muted-foreground/80">{result.summary}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 border border-primary/10 text-sm text-foreground/85">
            <ListChecks className="w-3 h-3" />
            {fields.length}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 border border-primary/10 text-sm text-foreground/85">
            <KeyRound className="w-3 h-3" />
            {requiredCount}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-secondary/50 border border-primary/10 text-sm text-foreground/85">
            <CircleHelp className="w-3 h-3" />
            {optionalCount}
          </span>
        </div>
        <span className="px-2 py-0.5 bg-primary/10 text-primary/70 text-sm rounded-md font-mono">
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
        <AnimatePresence>
          {!showNegotiator ? (
            <motion.div
              key="neg-trigger"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${AI_STATUS.bgColor} ${AI_STATUS.borderColor}`}
            >
              <Bot className={`w-4 h-4 shrink-0 ${AI_STATUS.color}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground/90">
                  <span className={`${AI_STATUS.color} font-medium`}>Auto-provision available</span>{' '}
                  — let AI guide you through obtaining your {result.connector.label} credentials step-by-step.
                </p>
              </div>
              <button
                onClick={() => setShowNegotiator(true)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${AI_STATUS.bgColor} ${AI_STATUS.borderColor} ${AI_STATUS.color} hover:opacity-90`}
              >
                Start
              </button>
            </motion.div>
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
        </AnimatePresence>
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
      <div className={`flex items-start gap-2.5 px-3 py-2 rounded-xl border ${SUCCESS_STATUS.bgColor} ${SUCCESS_STATUS.borderColor}`}>
        <Shield className={`w-4 h-4 mt-0.5 shrink-0 ${SUCCESS_STATUS.color}`} />
        <p className="text-sm text-foreground/80">
          Credentials are stored securely in the app vault and are available for agent tool execution.
        </p>
      </div>

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
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: [0.8, 1.08, 1], opacity: 1, boxShadow: ['0 0 0 rgba(16,185,129,0)', '0 0 12px rgba(16,185,129,0.2)', '0 0 0 rgba(16,185,129,0)'] }}
          transition={{ duration: 0.4 }}
          className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-sm ${SUCCESS_STATUS.bgColor} ${SUCCESS_STATUS.borderColor} ${SUCCESS_STATUS.color}`}
        >
          <CheckCircle className="w-3.5 h-3.5" />
          Tested successfully at {lastSuccessfulTestAt}
        </motion.div>
      )}
    </motion.div>
  );
}
