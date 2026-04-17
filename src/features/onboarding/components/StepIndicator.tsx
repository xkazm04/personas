import {
  Palette,
  Monitor,
  FlaskConical,
  Download,
  Play,
  Check,
  ArrowRight,
} from 'lucide-react';
import type { OnboardingStep } from '@/stores/slices/system/onboardingSlice';
import { useTranslation } from '@/i18n/useTranslation';

/** Step metadata with i18n-aware labels. Call `useSteps()` inside a component. */
export function useSteps() {
  const { t } = useTranslation();
  return [
    { key: 'appearance' as OnboardingStep, label: t.onboarding.step_appearance, icon: Palette },
    { key: 'discover' as OnboardingStep, label: t.onboarding.step_discover, icon: Monitor },
    { key: 'pick-template' as OnboardingStep, label: t.onboarding.step_pick_template, icon: FlaskConical },
    { key: 'adopt' as OnboardingStep, label: t.onboarding.step_adopt, icon: Download },
    { key: 'execute' as OnboardingStep, label: t.onboarding.step_execute, icon: Play },
  ];
}

/** @deprecated Use `useSteps()` for i18n support. Kept for backward-compatible imports. */
export const STEPS: { key: OnboardingStep; label: string; icon: typeof FlaskConical }[] = [
  { key: 'appearance', label: 'Look & Feel', icon: Palette },
  { key: 'discover', label: 'Desktop', icon: Monitor },
  { key: 'pick-template', label: 'Pick Template', icon: FlaskConical },
  { key: 'adopt', label: 'Set Up Agent', icon: Download },
  { key: 'execute', label: 'First Run', icon: Play },
];

export function StepIndicator({
  steps,
  currentStep,
  completedSteps,
}: {
  steps: typeof STEPS;
  currentStep: OnboardingStep;
  completedSteps: Record<OnboardingStep, boolean>;
}) {
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, i) => {
        const Icon = step.icon;
        const isCurrent = step.key === currentStep;
        const isCompleted = completedSteps[step.key];

        return (
          <div key={step.key} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-card typo-heading transition-colors ${
                isCurrent
                  ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25'
                  : isCompleted
                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    : 'bg-secondary/30 text-muted-foreground/50 border border-primary/10'
              }`}
            >
              {isCompleted ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Icon className="w-3.5 h-3.5" />
              )}
              {step.label}
            </div>
            {i < steps.length - 1 && (
              <ArrowRight className="w-3 h-3 text-muted-foreground/30" />
            )}
          </div>
        );
      })}
    </div>
  );
}
