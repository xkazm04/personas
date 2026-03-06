import { motion } from 'framer-motion';
import { Sparkles, Check } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { OnboardingStep } from '@/stores/slices/onboardingSlice';

const STEP_LABELS: Record<OnboardingStep, string> = {
  'pick-template': 'Pick template',
  'adopt': 'Adopt agent',
  'execute': 'First run',
};

const STEP_ORDER: OnboardingStep[] = ['pick-template', 'adopt', 'execute'];

export default function OnboardingProgressBar() {
  const onboardingActive = usePersonaStore((s) => s.onboardingActive);
  const onboardingCompleted = usePersonaStore((s) => s.onboardingCompleted);
  const onboardingStep = usePersonaStore((s) => s.onboardingStep);
  const onboardingStepCompleted = usePersonaStore((s) => s.onboardingStepCompleted);
  const personas = usePersonaStore((s) => s.personas);

  // Don't show if onboarding is completed or if user already has personas
  if (onboardingCompleted || personas.length > 0) return null;
  // Only show when onboarding is active
  if (!onboardingActive) return null;

  const completedCount = STEP_ORDER.filter((s) => onboardingStepCompleted[s]).length;
  const progressPct = (completedCount / STEP_ORDER.length) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="mx-3 mb-2"
    >
      <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-3 space-y-2.5">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-sm font-medium text-violet-300">Getting Started</span>
          <span className="ml-auto text-sm text-violet-400/60">{completedCount}/3</span>
        </div>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-violet-500/10 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-violet-500 rounded-full"
            initial={{ width: 0 }}
            animate={{ width: `${progressPct}%` }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
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
                  className={`text-sm ${
                    isCompleted
                      ? 'text-emerald-400/70 line-through'
                      : isCurrent
                        ? 'text-violet-300'
                        : 'text-muted-foreground/50'
                  }`}
                >
                  {STEP_LABELS[step]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
