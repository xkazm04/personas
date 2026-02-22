import { motion } from 'framer-motion';
import type { DesignPhase } from '@/lib/types/designTypes';

const STAGES = [
  { key: 'input', label: 'Input' },
  { key: 'analyzing', label: 'Analyzing' },
  { key: 'question', label: 'Question' },
  { key: 'review', label: 'Review' },
  { key: 'applied', label: 'Applied' },
] as const;

type StageKey = (typeof STAGES)[number]['key'];

/** Map the 7 internal DesignPhase values to 5 visible stage keys */
function phaseToStageIndex(phase: DesignPhase): number {
  const map = {
    idle: 'input',
    analyzing: 'analyzing',
    'awaiting-input': 'question',
    refining: 'analyzing', // refining reuses the analyzing visual stage (same spinner treatment)
    preview: 'review',
    applying: 'applied',
    applied: 'applied',
  } satisfies Record<DesignPhase, StageKey>;
  const key = map[phase];
  return STAGES.findIndex((s) => s.key === key);
}

interface PhaseIndicatorProps {
  phase: DesignPhase;
}

export function PhaseIndicator({ phase }: PhaseIndicatorProps) {
  const activeIndex = phaseToStageIndex(phase);

  // Don't render when idle — the indicator is only useful once the workflow starts
  if (phase === 'idle') return null;

  return (
    <div className="flex items-center gap-1 px-1 py-1">
      {STAGES.map((stage, i) => {
        const isCompleted = i < activeIndex;
        const isActive = i === activeIndex;

        return (
          <div key={stage.key} className="flex items-center gap-1 flex-1 last:flex-initial">
            {/* Dot + label group */}
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="relative flex items-center justify-center">
                {/* Active ring pulse */}
                {isActive && (
                  <motion.div
                    layoutId="phase-ring"
                    className={`absolute w-4 h-4 rounded-full ${
                      phase === 'awaiting-input' ? 'bg-purple-500/20' : 'bg-primary/20'
                    }`}
                    initial={false}
                    animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
                <motion.div
                  layoutId="phase-dot-highlight"
                  className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                    isActive
                      ? phase === 'awaiting-input'
                        ? 'bg-purple-400 shadow-sm shadow-purple-400/40'
                        : 'bg-primary shadow-sm shadow-primary/40'
                      : isCompleted
                        ? 'bg-emerald-400'
                        : 'bg-secondary/40'
                  }`}
                  {...(isActive && {
                    animate: {},
                    layout: true,
                  })}
                />
              </div>
              <span
                className={`text-[10px] font-medium truncate transition-colors duration-300 ${
                  isActive
                    ? phase === 'awaiting-input'
                      ? 'text-purple-300'
                      : 'text-foreground/80'
                    : isCompleted
                      ? 'text-emerald-400/70'
                      : 'text-muted-foreground/30'
                }`}
              >
                {stage.label}
              </span>
            </div>

            {/* Connector line (not after last item) */}
            {i < STAGES.length - 1 && (
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
