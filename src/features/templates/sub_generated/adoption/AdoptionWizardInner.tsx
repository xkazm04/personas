import { useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertCircle, Download } from 'lucide-react';
import { DimensionRadial } from '../shared/DimensionRadial';
import { TrustBadge } from '../shared/TrustBadge';
import { SandboxWarningBanner } from '../shared/SandboxWarningBanner';
import { WizardSidebar, QuickAdoptConfirm } from './steps';
import type { AdoptWizardStep } from './hooks/useAdoptReducer';
import { useAdoptionWizard } from './AdoptionWizardContext';
import { useTemplateMotion } from '@/features/templates/animationPresets';
import { BaseModal } from '../shared/BaseModal';
import { BackButton } from './BackButton';
import { SIDEBAR_STEPS, STEP_COMPONENTS } from './wizardConstants';
import { getNextAction, getBackLabel } from './state/getNextAction';

export function AdoptionWizardInner({ onClose }: { onClose: () => void }) {
  const { motion: MOTION } = useTemplateMotion();
  const {
    state, wizard, designResult, completedSteps,
    requiredConnectors, verification, safetyScan,
    handleNext, cleanupAll, saveDraftToStore,
  } = useAdoptionWizard();

  const handleClose = useCallback(() => {
    if (state.confirming) return;
    if (!state.created) saveDraftToStore();
    if (state.created || !state.transforming) {
      void cleanupAll();
      wizard.reset();
    }
    onClose();
  }, [state.confirming, state.created, state.transforming, cleanupAll, wizard, onClose, saveDraftToStore]);

  const handleSidebarStepClick = useCallback(
    (step: AdoptWizardStep) => {
      if (state.transforming || state.confirming) return;
      wizard.goToStep(step);
    },
    [state.transforming, state.confirming, wizard],
  );

  const nextAction = getNextAction(state, requiredConnectors, safetyScan);
  const backLabel = () => getBackLabel(state.step, state.transforming);
  const StepComponent = STEP_COMPONENTS[state.step];

  return (
    <BaseModal isOpen onClose={handleClose} titleId="adoption-wizard-title" maxWidthClass="max-w-[1400px]"
      panelClassName="h-[92vh] bg-background border border-primary/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 8 }}
        transition={MOTION.smooth.framer}
        className="relative h-full overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-primary/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
              <Download className="w-4.5 h-4.5 text-violet-400" />
            </div>
            <div>
              <h2 id="adoption-wizard-title" className="text-sm font-semibold text-foreground/90">Adopt Template</h2>
              <p className="text-sm text-muted-foreground/90">{state.templateName}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <TrustBadge trustLevel={verification.trustLevel} />
            {designResult && <DimensionRadial designResult={designResult} size={28} />}
            <button onClick={handleClose} disabled={state.confirming}
              className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/80 hover:text-foreground/95 disabled:opacity-30"
              title={state.transforming ? 'Close (processing continues in background)' : 'Close'}>
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {state.error && state.step !== 'build' && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            className="mx-6 mt-2 flex items-start gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
            <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-400/80 flex-1">{state.error}</p>
            <button onClick={() => wizard.clearError()} className="text-red-400/50 hover:text-red-400 text-sm">Dismiss</button>
          </motion.div>
        )}

        {verification.trustLevel !== 'verified' && state.step === 'choose' && (
          <SandboxWarningBanner verification={verification} className="mx-6 mt-3" />
        )}

        {/* Main body */}
        {state.autoResolved && state.step === 'choose' ? (
          <div className="flex-1 flex items-center justify-center min-h-0"><QuickAdoptConfirm /></div>
        ) : (
          <div className="flex flex-1 min-h-0">
            <WizardSidebar steps={SIDEBAR_STEPS} currentStep={state.step} completedSteps={completedSteps}
              onStepClick={handleSidebarStepClick} disabled={state.transforming || state.confirming} />
            <div className="flex-1 overflow-y-auto min-h-0 p-6">
              <AnimatePresence mode="wait">
                {(state.step !== 'choose' || designResult) && (
                  <motion.div key={state.step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }} transition={MOTION.snappy.framer} className={undefined}>
                    <StepComponent />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className={`flex items-center justify-between px-6 py-3 border-t border-primary/10 bg-secondary/10 flex-shrink-0${state.autoResolved && state.step === 'choose' ? ' hidden' : ''}`}>
          <BackButton state={state} onClose={handleClose} onBack={() => wizard.goBack()} getBackLabel={backLabel} />
          <div className="flex items-center gap-2">
            {nextAction && (
              <button onClick={() => { if (state.created) handleClose(); else handleNext(); }} disabled={nextAction.disabled}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-xl border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  nextAction.variant === 'emerald' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/25' : 'bg-violet-500/15 text-violet-300 border-violet-500/25 hover:bg-violet-500/25'
                }`}>
                <nextAction.icon className={`w-4 h-4 ${nextAction.spinning ? 'animate-spin' : ''}`} />
                {nextAction.label}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </BaseModal>
  );
}
