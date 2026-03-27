import { useEffect, useRef, useState } from 'react';
import { Clock, AlertTriangle, Lightbulb, CheckCircle, SkipForward } from 'lucide-react';
import type { NegotiationPlan } from '@/hooks/design/credential/useCredentialNegotiator';
import type { StepNode } from '@/hooks/design/credential/negotiatorStepGraph';
import { NegotiatorStepCard } from './NegotiatorStepCard';

interface NegotiatorGuidingPhaseProps {
  plan: NegotiationPlan;
  activeStepIndex: number;
  completedSteps: Set<number>;
  capturedValues: Record<string, string>;
  stepHelp: { answer: string; stepIndex: number } | null;
  isLoadingHelp: boolean;
  /** Resolved visible steps from the step graph */
  visibleSteps: StepNode[];
  /** Steps that were skipped by the step graph */
  skippedSteps: StepNode[];
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
  visibleSteps,
  skippedSteps,
  onCompleteStep,
  onSelectStep,
  onCaptureValue,
  onRequestHelp,
  onCancel,
  onFinish,
}: NegotiatorGuidingPhaseProps) {
  const totalSteps = visibleSteps.length;
  const completedCount = completedSteps.size;
  const allDone = totalSteps > 0 && completedCount >= totalSteps;
  const progressPercent = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;

  // Focus management: move focus to the newly active step header on transitions
  const prevStepRef = useRef(activeStepIndex);
  const [liveAnnouncement, setLiveAnnouncement] = useState('');

  useEffect(() => {
    if (prevStepRef.current !== activeStepIndex) {
      prevStepRef.current = activeStepIndex;
      const headerId = `negotiator-step-header-${activeStepIndex}`;
      // Allow the DOM to update before focusing (animation frame)
      requestAnimationFrame(() => {
        document.getElementById(headerId)?.focus();
      });
      // Announce step transition for screen readers
      const activeStep = visibleSteps[activeStepIndex];
      if (activeStep) {
        setLiveAnnouncement(
          `Step ${activeStepIndex + 1} of ${totalSteps}: ${activeStep.step.title}`,
        );
      }
    }
  }, [activeStepIndex, visibleSteps, totalSteps]);

  return (
    <div
      key="negotiator-guiding"
      className="animate-fade-slide-in space-y-4"
    >
      {/* Live region for screen reader step-transition announcements */}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveAnnouncement}
      </div>
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
          {skippedSteps.length > 0 && (
            <>
              <div className="h-3 w-px bg-primary/10" />
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground/60">
                <SkipForward className="w-3 h-3" />
                {skippedSteps.length} skipped
              </span>
            </>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-32 h-1.5 bg-secondary/60 rounded-full overflow-hidden">
          <div style={{ width: `${progressPercent}%` }}
            className="animate-fade-in h-full bg-gradient-to-r from-violet-500 to-emerald-500 rounded-full"
          />
        </div>
      </div>

      {/* Skipped steps summary */}
      {skippedSteps.length > 0 && (
        <details className="group rounded-xl border border-primary/10 bg-secondary/15 px-4 py-2">
          <summary className="cursor-pointer text-sm text-muted-foreground/70 hover:text-muted-foreground transition-colors flex items-center gap-1.5">
            <SkipForward className="w-3 h-3" />
            {skippedSteps.length} step{skippedSteps.length !== 1 ? 's' : ''} auto-skipped
          </summary>
          <ul className="mt-2 space-y-1 pl-5">
            {skippedSteps.map((node) => (
              <li key={node.originalIndex} className="text-sm text-muted-foreground/60">
                <span className="line-through">{node.step.title}</span>
                {node.skipReason && (
                  <span className="ml-1.5 text-muted-foreground/40">-- {node.skipReason}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

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

      {/* Steps -- render only visible steps */}
      <div className="space-y-2">
        {visibleSteps.map((node, visibleIndex) => (
          <NegotiatorStepCard
            key={node.originalIndex}
            step={node.step}
            stepIndex={visibleIndex}
            totalSteps={totalSteps}
            isActive={activeStepIndex === visibleIndex}
            isCompleted={completedSteps.has(visibleIndex)}
            capturedValues={capturedValues}
            onComplete={() => onCompleteStep(visibleIndex)}
            onSelect={() => onSelectStep(visibleIndex)}
            onCaptureValue={onCaptureValue}
            onRequestHelp={(q) => onRequestHelp(visibleIndex, q)}
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
        <div
          className="animate-fade-slide-in flex items-start gap-2.5 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl"
        >
          <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-emerald-300 font-medium">All steps completed</p>
            <p className="text-sm text-emerald-200/60 mt-0.5">{plan.verification_hint}</p>
          </div>
        </div>
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
          <button
            onClick={onFinish}
            className="animate-fade-slide-in px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 rounded-xl text-sm font-medium transition-colors"
          >
            Apply credentials
          </button>
        )}
      </div>
    </div>
  );
}
