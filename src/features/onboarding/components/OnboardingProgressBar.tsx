import { Sparkles, Check } from 'lucide-react';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import type { OnboardingStep } from '@/stores/slices/system/onboardingSlice';
import { useTranslation } from '@/i18n/useTranslation';

const STEP_ORDER: OnboardingStep[] = ['appearance', 'discover', 'pick-template', 'adopt', 'execute'];

export default function OnboardingProgressBar() {
  const { t } = useTranslation();
  const onboardingActive = useSystemStore((s) => s.onboardingActive);
  const onboardingCompleted = useSystemStore((s) => s.onboardingCompleted);
  const onboardingStep = useSystemStore((s) => s.onboardingStep);
  const onboardingStepCompleted = useSystemStore((s) => s.onboardingStepCompleted);
  const personas = useAgentStore((s) => s.personas);

  const STEP_LABELS: Record<OnboardingStep, string> = {
    'appearance': t.onboarding.progress_appearance,
    'discover': t.onboarding.progress_discover,
    'pick-template': t.onboarding.progress_pick_template,
    'adopt': t.onboarding.progress_adopt,
    'execute': t.onboarding.progress_execute,
  };

  // Don't show if onboarding is completed or if user already has personas
  if (onboardingCompleted || personas.length > 0) return null;
  // Only show when onboarding is active
  if (!onboardingActive) return null;

  const completedCount = STEP_ORDER.filter((s) => onboardingStepCompleted[s]).length;
  const progressPct = (completedCount / STEP_ORDER.length) * 100;

  return (
    <div
      className="animate-fade-slide-in mx-3 mb-2"
    >
      <div className="rounded-modal border border-violet-500/20 bg-violet-500/5 p-3 space-y-2.5">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-violet-400" />
          <span className="typo-heading text-violet-300">{t.onboarding.getting_started}</span>
          <span className="ml-auto typo-body text-violet-400/60">{completedCount}/{STEP_ORDER.length}</span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-violet-500/10 rounded-full overflow-hidden">
          <div
            className="animate-fade-in h-full bg-violet-500 rounded-full" style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Step checklist */}
        <div className="space-y-1">
          {STEP_ORDER.map((step) => {
            const isCompleted = onboardingStepCompleted[step];
            const isCurrent = onboardingStep === step;

            return (
              <div key={step} className="flex items-center gap-2">
                {isCompleted ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <div
                    className={`w-3 h-3 rounded-full border ${
                      isCurrent
                        ? 'border-violet-400 bg-violet-500/20'
                        : 'border-primary/15 bg-transparent'
                    }`}
                  />
                )}
                <span
                  className={`typo-body ${
                    isCompleted
                      ? 'text-emerald-400/70 line-through'
                      : isCurrent
                        ? 'text-violet-300'
                        : 'text-foreground'
                  }`}
                >
                  {STEP_LABELS[step]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
