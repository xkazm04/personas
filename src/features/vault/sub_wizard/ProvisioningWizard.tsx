import { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Bot, ArrowLeft, Sparkles } from 'lucide-react';
import { useProvisioningWizardStore } from '@/stores/provisioningWizardStore';
import { usePersonaStore } from '@/stores/personaStore';
import { useCredentialNegotiator } from '@/hooks/design/useCredentialNegotiator';
import { NegotiatorPlanningPhase } from '@/features/vault/sub_negotiator/NegotiatorPlanningPhase';
import { NegotiatorGuidingPhase } from '@/features/vault/sub_negotiator/NegotiatorGuidingPhase';
import { WizardServiceSelect } from './WizardServiceSelect';
import type { ConnectorDefinition } from '@/lib/types/types';

export function ProvisioningWizard() {
  const phase = useProvisioningWizardStore((s) => s.phase);
  const selectedConnector = useProvisioningWizardStore((s) => s.selectedConnector);
  const selectConnector = useProvisioningWizardStore((s) => s.selectConnector);
  const back = useProvisioningWizardStore((s) => s.back);
  const close = useProvisioningWizardStore((s) => s.close);

  const createCredential = usePersonaStore((s) => s.createCredential);
  const fetchCredentials = usePersonaStore((s) => s.fetchCredentials);

  const negotiator = useCredentialNegotiator();

  const handleSelectConnector = useCallback(
    (connector: ConnectorDefinition) => {
      selectConnector(connector);
      const fieldKeys = connector.fields.map((f) => f.key);
      negotiator.start(
        connector.label,
        connector as unknown as Record<string, unknown>,
        fieldKeys,
      );
    },
    [selectConnector, negotiator],
  );

  const handleBack = useCallback(() => {
    if (negotiator.phase === 'planning') {
      negotiator.cancel();
    }
    negotiator.reset();
    back();
  }, [negotiator, back]);

  const handleClose = useCallback(() => {
    if (negotiator.phase === 'planning') {
      negotiator.cancel();
    }
    negotiator.reset();
    close();
  }, [negotiator, close]);

  const handleFinish = useCallback(async () => {
    if (!selectedConnector) return;
    const values = negotiator.capturedValues;
    const name = `${selectedConnector.label} Credential`;
    try {
      await createCredential({
        name,
        service_type: selectedConnector.name,
        data: values,
      });
      await fetchCredentials();
    } catch {
      // Error is handled by store
    }
    negotiator.reset();
    close();
  }, [selectedConnector, negotiator, createCredential, fetchCredentials, close]);

  const handleRetry = useCallback(() => {
    if (!selectedConnector) return;
    const fieldKeys = selectedConnector.fields.map((f) => f.key);
    negotiator.start(
      selectedConnector.label,
      selectedConnector as unknown as Record<string, unknown>,
      fieldKeys,
    );
  }, [selectedConnector, negotiator]);

  if (phase === 'closed') return null;

  const isProvisioning = phase === 'provisioning';
  const subtitle = isProvisioning && selectedConnector
    ? `Setting up ${selectedConnector.label}`
    : 'AI-guided credential setup';

  return (
    <AnimatePresence>
      <motion.div
        key="provisioning-wizard-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) handleClose();
        }}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="relative w-full max-w-2xl max-h-[85vh] bg-background border border-primary/15 rounded-2xl shadow-2xl shadow-black/30 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-primary/10 shrink-0">
            <div className="flex items-center gap-3">
              {isProvisioning && (
                <button
                  onClick={handleBack}
                  className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/80 hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <div className="w-8 h-8 rounded-xl bg-violet-500/15 flex items-center justify-center">
                <Sparkles className="w-4.5 h-4.5 text-violet-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold tracking-tight text-foreground">
                  Credential Provisioning Wizard
                </h2>
                <p className="text-sm text-muted-foreground/80">{subtitle}</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/80 hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            <AnimatePresence mode="wait">
              {/* Phase 1: Service selection */}
              {phase === 'select-service' && (
                <motion.div
                  key="wizard-select"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                >
                  <WizardServiceSelect
                    onSelect={handleSelectConnector}
                    isPro={false}
                  />
                </motion.div>
              )}

              {/* Phase 2: Provisioning */}
              {phase === 'provisioning' && (
                <motion.div
                  key="wizard-provision"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-4"
                >
                  {/* Planning */}
                  {negotiator.phase === 'planning' && (
                    <NegotiatorPlanningPhase
                      progressLines={negotiator.progressLines}
                      onCancel={handleBack}
                    />
                  )}

                  {/* Guiding */}
                  {negotiator.phase === 'guiding' && negotiator.plan && (
                    <NegotiatorGuidingPhase
                      plan={negotiator.plan}
                      activeStepIndex={negotiator.activeStepIndex}
                      completedSteps={negotiator.completedSteps}
                      capturedValues={negotiator.capturedValues}
                      stepHelp={negotiator.stepHelp}
                      isLoadingHelp={negotiator.isLoadingHelp}
                      onCompleteStep={negotiator.completeStep}
                      onSelectStep={negotiator.goToStep}
                      onCaptureValue={negotiator.captureValue}
                      onRequestHelp={negotiator.requestStepHelp}
                      onCancel={handleBack}
                      onFinish={handleFinish}
                    />
                  )}

                  {/* Done */}
                  {negotiator.phase === 'done' && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex flex-col items-center py-10 gap-4"
                    >
                      <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center">
                        <Bot className="w-6 h-6 text-emerald-400" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium text-foreground">Credentials captured!</p>
                        <p className="text-sm text-muted-foreground/80 mt-1">
                          {Object.keys(negotiator.capturedValues).length} field(s) ready to save
                          {selectedConnector ? ` for ${selectedConnector.label}` : ''}.
                        </p>
                      </div>
                      <button
                        onClick={handleFinish}
                        className="px-6 py-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 rounded-xl text-sm font-medium transition-colors"
                      >
                        Save credential
                      </button>
                    </motion.div>
                  )}

                  {/* Error */}
                  {negotiator.phase === 'error' && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="space-y-4"
                    >
                      <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                        <p className="text-sm text-red-300">{negotiator.error}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleRetry}
                          className="px-4 py-2 rounded-xl bg-secondary/60 hover:bg-secondary border border-primary/15 text-foreground/90 text-sm transition-colors"
                        >
                          Try again
                        </button>
                        <button
                          onClick={handleBack}
                          className="px-4 py-2 rounded-xl text-muted-foreground/90 text-sm hover:text-foreground/95 transition-colors"
                        >
                          Pick another service
                        </button>
                      </div>
                    </motion.div>
                  )}

                  {/* Idle state (shouldn't normally show, fallback) */}
                  {negotiator.phase === 'idle' && selectedConnector && (
                    <div className="text-center py-8">
                      <p className="text-sm text-muted-foreground/80">Preparing provisioning plan...</p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
