import { Clock, AlertTriangle, Lightbulb, CheckCircle, SkipForward } from 'lucide-react';
import type { NegotiationPlan } from '@/hooks/design/credential/useCredentialNegotiator';
import type { StepNode } from '@/hooks/design/credential/negotiatorStepGraph';
import { NegotiatorStepCard } from './NegotiatorStepCard';
import { useTranslation } from '@/i18n/useTranslation';

interface GuidingProgressBarProps {
  plan: NegotiationPlan;
  completedCount: number;
  totalSteps: number;
  skippedSteps: StepNode[];
  progressPercent: number;
}

export function GuidingProgressBar({ plan, completedCount, totalSteps, skippedSteps, progressPercent }: GuidingProgressBarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-secondary/30 border border-primary/10 rounded-modal">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-foreground" />
          <span className="text-sm text-foreground">
            ~{Math.ceil(plan.estimated_time_seconds / 60)} min
          </span>
        </div>
        <div className="h-3 w-px bg-primary/10" />
        <span className="text-sm text-foreground font-medium">
          {completedCount}/{totalSteps} steps
        </span>
        {skippedSteps.length > 0 && (
          <>
            <div className="h-3 w-px bg-primary/10" />
            <span className="inline-flex items-center gap-1 text-sm text-foreground">
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
  );
}

interface GuidingSkippedSummaryProps {
  skippedSteps: StepNode[];
}

export function GuidingSkippedSummary({ skippedSteps }: GuidingSkippedSummaryProps) {
  if (skippedSteps.length === 0) return null;

  return (
    <details className="group rounded-modal border border-primary/10 bg-secondary/15 px-4 py-2">
      <summary className="cursor-pointer text-sm text-foreground hover:text-muted-foreground transition-colors flex items-center gap-1.5">
        <SkipForward className="w-3 h-3" />
        {skippedSteps.length} step{skippedSteps.length !== 1 ? 's' : ''} auto-skipped
      </summary>
      <ul className="mt-2 space-y-1 pl-5">
        {skippedSteps.map((node) => (
          <li key={node.originalIndex} className="text-sm text-foreground">
            <span className="line-through">{node.step.title}</span>
            {node.skipReason && (
              <span className="ml-1.5 text-foreground">-- {node.skipReason}</span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

interface GuidingPrerequisitesProps {
  prerequisites: string[];
}

export function GuidingPrerequisites({ prerequisites }: GuidingPrerequisitesProps) {
  const { t } = useTranslation();
  if (prerequisites.length === 0) return null;

  return (
    <div className="px-4 py-2.5 bg-amber-500/5 border border-amber-500/15 rounded-modal">
      <div className="flex items-center gap-2 mb-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-sm font-medium text-amber-300/80">{t.vault.negotiator.prerequisites}</span>
      </div>
      <ul className="space-y-0.5">
        {prerequisites.map((prereq, i) => (
          <li key={i} className="text-sm text-amber-200/60 pl-5">
            {prereq}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface GuidingStepListProps {
  visibleSteps: StepNode[];
  activeStepIndex: number;
  completedSteps: Set<number>;
  capturedValues: Record<string, string>;
  stepHelp: { answer: string; stepIndex: number } | null;
  isLoadingHelp: boolean;
  onCompleteStep: (index: number) => void;
  onSelectStep: (index: number) => void;
  onCaptureValue: (fieldKey: string, value: string) => void;
  onRequestHelp: (stepIndex: number, question: string) => void;
}

export function GuidingStepList({
  visibleSteps,
  activeStepIndex,
  completedSteps,
  capturedValues,
  stepHelp,
  isLoadingHelp,
  onCompleteStep,
  onSelectStep,
  onCaptureValue,
  onRequestHelp,
}: GuidingStepListProps) {
  const totalSteps = visibleSteps.length;

  return (
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
  );
}

interface GuidingTipsProps {
  tips: string[];
}

export function GuidingTips({ tips }: GuidingTipsProps) {
  if (tips.length === 0) return null;

  return (
    <details className="group rounded-modal border border-primary/10 bg-secondary/20 px-4 py-2.5">
      <summary className="cursor-pointer text-sm text-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
        <Lightbulb className="w-3 h-3" />
        Tips & best practices
      </summary>
      <ul className="mt-2 space-y-1 pl-5">
        {tips.map((tip, i) => (
          <li key={i} className="text-sm text-foreground">
            {tip}
          </li>
        ))}
      </ul>
    </details>
  );
}

interface GuidingCompletionBannerProps {
  allDone: boolean;
  verificationHint: string | null;
}

export function GuidingCompletionBanner({ allDone, verificationHint }: GuidingCompletionBannerProps) {
  const { t } = useTranslation();
  if (!allDone || !verificationHint) return null;

  return (
    <div
      className="animate-fade-slide-in flex items-start gap-2.5 px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 rounded-modal"
    >
      <CheckCircle className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
      <div>
        <p className="text-sm text-emerald-300 font-medium">{t.vault.negotiator.all_steps_completed}</p>
        <p className="text-sm text-emerald-200/60 mt-0.5">{verificationHint}</p>
      </div>
    </div>
  );
}
