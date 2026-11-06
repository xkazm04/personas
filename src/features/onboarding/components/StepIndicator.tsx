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

export function StepIndicator({
  steps,
  currentStep,
  completedSteps,
}: {
  steps: ReturnType<typeof useSteps>;
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
                  ? 'bg-role-agent/15 text-role-agent border border-role-agent/25'
                  : isCompleted
                    ? 'bg-status-success/10 text-status-success border border-status-success/20'
                    : 'bg-surface-1 text-ink-1 border border-hair'
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
              <ArrowRight className="w-3 h-3 text-ink-1" />
            )}
          </div>
        );
      })}
    </div>
  );
}
