import { motion } from 'framer-motion';
import { Clock, AlertTriangle, Lightbulb, CheckCircle } from 'lucide-react';
import type { NegotiationPlan } from '@/hooks/design/useCredentialNegotiator';
import { NegotiatorStepCard } from './NegotiatorStepCard';

interface NegotiatorGuidingPhaseProps {
  plan: NegotiationPlan;
  activeStepIndex: number;
  completedSteps: Set<number>;
  capturedValues: Record<string, string>;
  stepHelp: { answer: string; stepIndex: number } | null;
  isLoadingHelp: boolean;
  onCompleteStep: (index: number) => void;
  onSelectStep: (index: number) => void;
  onCaptureValue: (fieldKey: string, value: string) => void;
  onRequestHelp: (stepIndex: number, question: string) => void;
  onCancel: () => void;
  onFinish: () => void;
}

export function NegotiatorGuidingPhase({
  plan,
  activeStepIndex,
  completedSteps,
  capturedValues,
  stepHelp,
  isLoadingHelp,
  onCompleteStep,
  onSelectStep,
  onCaptureValue,
  onRequestHelp,
  onCancel,
  onFinish,
}: NegotiatorGuidingPhaseProps) {
  const completedCount = completedSteps.size;
  const totalSteps = plan.steps.length;
  const allDone = completedCount === totalSteps;
  const progressPercent = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;

  return (
    <motion.div
      key="negotiator-guiding"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-secondary/30 border border-primary/10 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-muted-foreground/90" />
            <span className="text-sm text-muted-foreground/90">
              ~{Math.ceil(plan.estimated_time_seconds / 60)} min
            </span>
          </div>
          <div className="h-3 w-px bg-primary/10" />
          <span className="text-sm text-foreground/80 font-medium">
            {completedCount}/{totalSteps} steps
          </span>
        </div>

        {/* Progress bar */}
        <div className="w-32 h-1.5 bg-secondary/60 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="h-full bg-gradient-to-r from-violet-500 to-emerald-500 rounded-full"
          />
        </div>
      </div>

      {/* Prerequisites */}
      {plan.prerequisites.length > 0 && (
        <div className="px-4 py-2.5 bg-amber-500/5 border border-amber-500/15 rounded-xl">
          <div className="flex items-center gap-2 mb-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-sm font-medium text-amber-300/80">Prerequisites</span>
          </div>
          <ul className="space-y-0.5">
            {plan.prerequisites.map((prereq, i) => (
              <li key={i} className="text-sm text-amber-200/60 pl-5">
                {prereq}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Steps */}
      <div className="space-y-2">
        {plan.steps.map((step, i) => (
          <NegotiatorStepCard
            key={i}
            step={step}
            stepIndex={i}
            isActive={activeStepIndex === i}
            isCompleted={completedSteps.has(i)}
            capturedValues={capturedValues}
            onComplete={() => onCompleteStep(i)}
            onSelect={() => onSelectStep(i)}
            onCaptureValue={onCaptureValue}
            onRequestHelp={(q) => onRequestHelp(i, q)}
            stepHelp={stepHelp}
            isLoadingHelp={isLoadingHelp}
          />
        ))}
      </div>

      {/* Tips */}
      {plan.tips.length > 0 && (
        <details className="group rounded-xl border border-primary/10 bg-secondary/20 px-4 py-2.5">
          <summary className="cursor-pointer text-sm text-foreground/80 hover:text-foreground transition-colors flex items-center gap-1.5">
            <Lightbulb className="w-3 h-3" />
            Tips & best practices
          </summary>
          <ul className="mt-2 space-y-1 pl-5">
            {plan.tips.map((tip, i) => (
              <li key={i} className="text-sm text-muted-foreground/90">
                {tip}
              </li>
            ))}
          </ul>
        </details>
      )}

      {/* Verification hint */}
      {allDone && plan.verification_hint && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-2.5 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl"
        >
          <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-emerald-300 font-medium">All steps completed</p>
            <p className="text-sm text-emerald-200/60 mt-0.5">{plan.verification_hint}</p>
          </div>
        </motion.div>
      )}

      {/* Footer buttons */}
      <div className="flex items-center justify-between pt-1">
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/90 rounded-xl text-sm transition-colors"
        >
          Cancel
        </button>
        {allDone && (
          <motion.button
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={onFinish}
            className="px-5 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 rounded-xl text-sm font-medium transition-colors"
          >
            Apply credentials
          </motion.button>
        )}
      </div>
    </motion.div>
  );
}
