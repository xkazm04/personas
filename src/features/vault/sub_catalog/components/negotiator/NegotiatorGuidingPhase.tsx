import { useEffect, useRef, useState } from 'react';
import type { NegotiationPlan } from '@/hooks/design/credential/useCredentialNegotiator';
import type { StepNode } from '@/hooks/design/credential/negotiatorStepGraph';
import {
  GuidingProgressBar,
  GuidingSkippedSummary,
  GuidingPrerequisites,
  GuidingStepList,
  GuidingTips,
  GuidingCompletionBanner,
} from './GuidingStepList';

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
      requestAnimationFrame(() => {
        document.getElementById(headerId)?.focus();
      });
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
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {liveAnnouncement}
      </div>

      <GuidingProgressBar
        plan={plan}
        completedCount={completedCount}
        totalSteps={totalSteps}
        skippedSteps={skippedSteps}
        progressPercent={progressPercent}
      />

      <GuidingSkippedSummary skippedSteps={skippedSteps} />

      <GuidingPrerequisites prerequisites={plan.prerequisites} />

      <GuidingStepList
        visibleSteps={visibleSteps}
        activeStepIndex={activeStepIndex}
        completedSteps={completedSteps}
        capturedValues={capturedValues}
        stepHelp={stepHelp}
        isLoadingHelp={isLoadingHelp}
        onCompleteStep={onCompleteStep}
        onSelectStep={onSelectStep}
        onCaptureValue={onCaptureValue}
        onRequestHelp={onRequestHelp}
      />

      <GuidingTips tips={plan.tips} />

      <GuidingCompletionBanner allDone={allDone} verificationHint={plan.verification_hint} />

      {/* Footer buttons */}
      <div className="flex items-center justify-between pt-1">
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/90 rounded-modal typo-body transition-colors"
        >
          Cancel
        </button>
        {allDone && (
          <button
            onClick={onFinish}
            className="animate-fade-slide-in px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 rounded-modal typo-body font-medium transition-colors"
          >
            Apply credentials
          </button>
        )}
      </div>
    </div>
  );
}
