import { motion, AnimatePresence } from 'framer-motion';
import { Bot, X, Zap } from 'lucide-react';
import { useCredentialNegotiator } from '@/hooks/design/useCredentialNegotiator';
import type { CredentialDesignResult } from '@/hooks/design/useCredentialDesign';
import { NegotiatorPlanningPhase } from './NegotiatorPlanningPhase';
import { NegotiatorGuidingPhase } from './NegotiatorGuidingPhase';

interface NegotiatorPanelProps {
  /** The credential design result with connector info and field definitions */
  designResult: CredentialDesignResult;
  /** Called when negotiation completes with captured values */
  onComplete: (capturedValues: Record<string, string>) => void;
  /** Called when the user closes/cancels the negotiator */
  onClose: () => void;
}

export function NegotiatorPanel({ designResult, onComplete, onClose }: NegotiatorPanelProps) {
  const negotiator = useCredentialNegotiator();

  const handleStart = () => {
    const fieldKeys = designResult.connector.fields.map((f) => f.key);
    negotiator.start(
      designResult.connector.label,
      designResult.connector as unknown as Record<string, unknown>,
      fieldKeys,
    );
  };

  const handleFinish = () => {
    onComplete(negotiator.capturedValues);
  };

  const handleClose = () => {
    if (negotiator.phase === 'planning') {
      negotiator.cancel();
    }
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="rounded-2xl border border-violet-500/20 bg-gradient-to-b from-violet-500/5 to-transparent">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-violet-500/10">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-violet-500/15 flex items-center justify-center">
              <Bot className="w-4 h-4 text-violet-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">AI Credential Negotiator</h3>
              <p className="text-[11px] text-muted-foreground/50">
                {negotiator.phase === 'idle' && 'Automated API key provisioning'}
                {negotiator.phase === 'planning' && 'Generating provisioning plan...'}
                {negotiator.phase === 'guiding' && `Provisioning ${designResult.connector.label}`}
                {negotiator.phase === 'done' && 'Credentials captured'}
                {negotiator.phase === 'error' && 'Something went wrong'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/40 hover:text-foreground transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4">
          <AnimatePresence mode="wait">
            {/* Idle — show the start button */}
            {negotiator.phase === 'idle' && (
              <motion.div
                key="neg-idle"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                <p className="text-xs text-foreground/70">
                  Let the AI guide you step-by-step through obtaining {designResult.connector.label} API credentials.
                  It will open the right pages, tell you exactly what to click, and auto-capture your keys.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleStart}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-500/15 border border-violet-500/25 text-violet-300 text-sm font-medium hover:bg-violet-500/25 transition-colors"
                  >
                    <Zap className="w-4 h-4" />
                    Start auto-provisioning
                  </button>
                  <span className="text-[11px] text-muted-foreground/40">
                    Takes ~{Math.ceil(60 / 60)}-2 minutes
                  </span>
                </div>
              </motion.div>
            )}

            {/* Planning */}
            {negotiator.phase === 'planning' && (
              <NegotiatorPlanningPhase
                progressLines={negotiator.progressLines}
                onCancel={negotiator.cancel}
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
                onCancel={handleClose}
                onFinish={handleFinish}
              />
            )}

            {/* Done */}
            {negotiator.phase === 'done' && (
              <motion.div
                key="neg-done"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center py-6 gap-3"
              >
                <div className="w-10 h-10 rounded-full bg-emerald-500/15 flex items-center justify-center">
                  <Zap className="w-5 h-5 text-emerald-400" />
                </div>
                <p className="text-sm text-foreground font-medium">Credentials captured</p>
                <p className="text-xs text-muted-foreground/50">
                  {Object.keys(negotiator.capturedValues).length} field(s) auto-filled from the provisioning flow.
                </p>
                <button
                  onClick={handleFinish}
                  className="px-5 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 rounded-xl text-sm font-medium transition-colors mt-1"
                >
                  Apply to credential form
                </button>
              </motion.div>
            )}

            {/* Error */}
            {negotiator.phase === 'error' && (
              <motion.div
                key="neg-error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-3"
              >
                <div className="px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <p className="text-xs text-red-300">{negotiator.error}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleStart}
                    className="px-4 py-2 rounded-xl bg-secondary/60 hover:bg-secondary border border-primary/15 text-foreground/70 text-sm transition-colors"
                  >
                    Try again
                  </button>
                  <button
                    onClick={handleClose}
                    className="px-4 py-2 rounded-xl text-muted-foreground/50 text-sm hover:text-foreground/70 transition-colors"
                  >
                    Close
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
