import { motion } from 'framer-motion';
import { Check, MessageSquare, Pencil, Sparkles } from 'lucide-react';
import type { TransformSubPhase } from '../hooks/useN8nImportReducer';
import { useTranslation } from '@/i18n/useTranslation';

interface StepDef {
  id: TransformSubPhase;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface TransformPhaseStepperProps {
  currentPhase: TransformSubPhase;
}

export function TransformPhaseStepper({ currentPhase }: TransformPhaseStepperProps) {
  const { t } = useTranslation();
  if (currentPhase === 'idle') return null;

  const TRANSFORM_STEPS: StepDef[] = [
    { id: 'asking', label: t.templates.n8n.analyze_phase, icon: MessageSquare },
    { id: 'answering', label: t.templates.n8n.questions_phase, icon: Pencil },
    { id: 'generating', label: t.templates.n8n.generate_phase, icon: Sparkles },
  ];

  const phaseIndex = (phase: TransformSubPhase): number => {
    const idx = TRANSFORM_STEPS.findIndex((s) => s.id === phase);
    if (phase === 'completed') return TRANSFORM_STEPS.length;
    if (phase === 'failed') return -1;
    return idx;
  };

  const activeIdx = phaseIndex(currentPhase);

  return (
    <nav
      className="flex items-center justify-center gap-1 py-2 px-3"
      role="navigation"
      aria-label="Transform progress"
    >
      {TRANSFORM_STEPS.map((step, i) => {
        const isCompleted = i < activeIdx;
        const isActive = i === activeIdx;
        const Icon = step.icon;

        return (
          <div key={step.id} className="flex items-center gap-1 flex-1 last:flex-initial">
            <div className="flex items-center gap-1.5 min-w-0">
              {/* Dot / check */}
              <div className="relative flex items-center justify-center">
                {isActive && (
                  <motion.div
                    className="absolute w-6 h-6 rounded-full bg-violet-500/20"
                    animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
                <motion.div
                  layoutId={`transform-step-dot-${step.id}`}
                  className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors duration-300 ${
                    isCompleted
                      ? 'bg-emerald-500/20 border border-emerald-400/40'
                      : isActive
                        ? 'bg-violet-500/30 border border-violet-400/50'
                        : 'bg-zinc-500/30 border border-zinc-500/20'
                  }`}
                >
                  {isCompleted ? (
                    <Check className="w-2.5 h-2.5 text-emerald-400" strokeWidth={3} />
                  ) : (
                    <Icon
                      className={`w-2.5 h-2.5 ${
                        isActive ? 'text-violet-300' : 'text-foreground'
                      }`}
                    />
                  )}
                </motion.div>
              </div>

              {/* Label */}
              <span
                className={`text-xs font-medium truncate transition-colors duration-300 ${
                  isCompleted
                    ? 'text-emerald-400/70'
                    : isActive
                      ? 'text-violet-300'
                      : 'text-foreground'
                }`}
              >
                {step.label}
              </span>
            </div>

            {/* Connector line */}
            {i < TRANSFORM_STEPS.length - 1 && (
              <div className="flex-1 h-px mx-1.5 min-w-4">
                <div
                  className={`h-full rounded-full transition-colors duration-300 ${
                    i < activeIdx ? 'bg-emerald-400/40' : 'bg-zinc-500/15'
                  }`}
                />
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
