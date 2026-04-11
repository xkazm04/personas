import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import type { DesignPhase } from '@/lib/types/designTypes';

const STAGE_KEYS = ['input', 'analyzing', 'question', 'review', 'applied', 'error'] as const;

type StageKey = (typeof STAGE_KEYS)[number];

/** Map the internal DesignPhase values to visible stage keys */
function phaseToStageIndex(phase: DesignPhase): number {
  const map = {
    idle: 'input',
    analyzing: 'analyzing',
    'awaiting-input': 'question',
    refining: 'analyzing', // refining reuses the analyzing visual stage (same spinner treatment)
    preview: 'review',
    applying: 'applied',
    applied: 'applied',
    error: 'error',
  } satisfies Record<DesignPhase, StageKey>;
  const key = map[phase];
  return STAGE_KEYS.indexOf(key);
}

interface PhaseIndicatorProps {
  phase: DesignPhase;
}

export function PhaseIndicator({ phase }: PhaseIndicatorProps) {
  const { t } = useTranslation();
  const activeIndex = phaseToStageIndex(phase);

  const STAGE_LABEL_MAP: Record<StageKey, string> = {
    input: t.agents.design.stage_input,
    analyzing: t.agents.design.stage_analyzing,
    question: t.agents.design.stage_question,
    review: t.agents.design.stage_review,
    applied: t.agents.design.stage_applied,
    error: t.agents.design.stage_error,
  };

  const isError = phase === 'error';

  // Don't render when idle -- the indicator is only useful once the workflow starts
  if (phase === 'idle') return null;

  return (
    <div
      className="flex items-center gap-1 px-1 py-1"
      role="progressbar"
      aria-label={t.agents.design.phase_progress_label}
      aria-valuemin={1}
      aria-valuemax={STAGE_KEYS.length}
      aria-valuenow={activeIndex + 1}
    >
      {STAGE_KEYS.map((stageKey, i) => {
        const isCompleted = i < activeIndex;
        const isActive = i === activeIndex;

        return (
          <div key={stageKey} className="flex items-center gap-1 flex-1 last:flex-initial">
            {/* Dot + label group */}
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="relative flex items-center justify-center">
                {/* Active ring pulse */}
                {isActive && (
                  <motion.div
                    layoutId="phase-ring"
                    className={`absolute w-4 h-4 rounded-full ${
                      isError ? 'bg-red-500/20'
                        : phase === 'awaiting-input' ? 'bg-purple-500/20' : 'bg-primary/20'
                    }`}
                    initial={false}
                    animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
                <motion.div
                  className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                    isActive
                      ? isError
                        ? 'bg-red-400 shadow-elevation-1 shadow-red-400/40'
                        : phase === 'awaiting-input'
                          ? 'bg-purple-400 shadow-elevation-1 shadow-purple-400/40'
                          : 'bg-primary shadow-elevation-1 shadow-primary/40'
                      : isCompleted
                        ? 'bg-emerald-400'
                        : 'bg-secondary/40'
                  }`}
                  {...(isActive && {
                    layoutId: 'phase-dot-highlight',
                    layout: true,
                  })}
                />
              </div>
              <span
                className={`text-sm font-medium truncate transition-colors duration-300 ${
                  isActive
                    ? isError
                      ? 'text-red-300'
                      : phase === 'awaiting-input'
                        ? 'text-purple-300'
                        : 'text-foreground/80'
                    : isCompleted
                      ? 'text-emerald-400/70'
                      : 'text-muted-foreground/80'
                }`}
              >
                {STAGE_LABEL_MAP[stageKey]}
              </span>
            </div>

            {/* Connector line (not after last item) */}
            {i < STAGE_KEYS.length - 1 && (
              <div className="flex-1 h-px mx-1 min-w-3">
                <div
                  className={`h-full rounded-full transition-colors duration-300 ${
                    i < activeIndex ? 'bg-emerald-400/50' : 'bg-secondary/30'
                  }`}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
