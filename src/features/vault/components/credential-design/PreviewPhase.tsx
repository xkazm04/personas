import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plug, CheckCircle, Shield, ListChecks, KeyRound, CircleHelp, Bot, PenLine, XCircle } from 'lucide-react';
import { CredentialEditForm } from '@/features/vault/components/CredentialEditForm';
import { NegotiatorPanel } from '@/features/vault/components/credential-negotiator/NegotiatorPanel';
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
      className="space-y-5"
    >
      {/* Save error banner */}
      {saveError && (
        <div className="flex items-start gap-2.5 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{saveError}</span>
        </div>
      )}

      {/* Match existing banner */}
      {result.match_existing && (
        <div className="flex items-start gap-3 px-4 py-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
          <Plug className="w-4 h-4 mt-0.5 text-blue-400 shrink-0" />
          <div className="text-sm">
            <span className="text-blue-300 font-medium">Existing connector found: </span>
            <span className="text-blue-400">{result.match_existing}</span>
            <p className="text-blue-300/60 text-sm mt-1">
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
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-violet-500/10 to-indigo-500/10 border border-violet-500/20"
            >
              <Bot className="w-4 h-4 text-violet-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground/90">
                  <span className="text-violet-300 font-medium">Auto-provision available</span>{' '}
                  — let AI guide you through obtaining your {result.connector.label} credentials step-by-step.
                </p>
              </div>
              <button
                onClick={() => setShowNegotiator(true)}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-violet-500/15 border border-violet-500/25 text-violet-300 text-sm font-medium hover:bg-violet-500/25 transition-colors"
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
      <div className="flex items-start gap-2.5 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
        <Shield className="w-4 h-4 text-emerald-300 mt-0.5 shrink-0" />
        <p className="text-sm text-emerald-200/80">
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
        saveDisabled={!canSaveCredential}
        saveDisabledReason={getSaveDisabledReason(credentialFlow)}
        onCancel={onReset}
      />

      {canSaveCredential && lastSuccessfulTestAt && (
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-sm">
          <CheckCircle className="w-3.5 h-3.5" />
          Tested successfully at {lastSuccessfulTestAt}
        </div>
      )}
    </motion.div>
  );
}
