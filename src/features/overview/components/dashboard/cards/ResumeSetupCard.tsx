import { RotateCcw, ArrowRight, X } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useShallow } from 'zustand/react/shallow';
import { STEPS } from '@/features/onboarding/components/StepIndicator';

export default function ResumeSetupCard() {
  const {
    onboardingActive,
    onboardingCompleted,
    onboardingDismissedAtStep,
    onboardingStepCompleted,
    resumeOnboarding,
    finishOnboarding,
  } = useSystemStore(useShallow((s) => ({
    onboardingActive: s.onboardingActive,
    onboardingCompleted: s.onboardingCompleted,
    onboardingDismissedAtStep: s.onboardingDismissedAtStep,
    onboardingStepCompleted: s.onboardingStepCompleted,
    resumeOnboarding: s.resumeOnboarding,
    finishOnboarding: s.finishOnboarding,
  })));

  // Only show when onboarding was dismissed mid-flow
  if (onboardingActive || onboardingCompleted || !onboardingDismissedAtStep) return null;

  const completedCount = STEPS.filter((s) => onboardingStepCompleted[s.key]).length;
  const currentStepLabel = STEPS.find((s) => s.key === onboardingDismissedAtStep)?.label ?? 'Setup';

  return (
    <div className="animate-fade-slide-in rounded-xl border border-violet-500/20 bg-gradient-to-r from-violet-500/8 to-indigo-500/5 p-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center flex-shrink-0">
          <RotateCcw className="w-5 h-5 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="typo-heading text-foreground/90">Resume Setup</h3>
          <p className="typo-body text-muted-foreground/70">
            You left off at <span className="text-violet-400 font-medium">{currentStepLabel}</span>
            {completedCount > 0 && (
              <> &mdash; {completedCount}/{STEPS.length} steps completed</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={finishOnboarding}
            className="p-2 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/50 hover:text-foreground/70"
            title="Skip setup entirely"
          >
            <X className="w-4 h-4" />
          </button>
          <button
            onClick={resumeOnboarding}
            className="flex items-center gap-2 px-4 py-2 typo-heading rounded-xl bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25 transition-colors"
          >
            Continue
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
