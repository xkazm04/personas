import { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2 } from 'lucide-react';
import { COMPILATION_STAGES } from '@/lib/compiler/personaCompiler';

// ── Stage inference from output lines ────────────────────────────

/**
 * Infer the active compilation stage index (0-4) from streaming output lines.
 *
 * The backend doesn't emit explicit stage events, so we use content heuristics:
 *   0 = prompt_assembly  — initial lines, "starting", "initializing", "assembling"
 *   1 = llm_generation   — once we see LLM output flowing (default while running)
 *   2 = result_parsing   — "parsing", "extracting", "transform_persona", JSON markers
 *   3 = feasibility_check — "feasibility", "validating", "checking"
 *   4 = persist          — "saving", "persisting", "writing"
 */
function inferStageIndex(lines: string[]): number {
  // Walk backwards through lines to find the latest stage marker
  for (let i = lines.length - 1; i >= 0; i--) {
    const lower = lines[i]!.toLowerCase();
    if (lower.includes('saving') || lower.includes('persisting') || lower.includes('writing to')) return 4;
    if (lower.includes('feasibility') || lower.includes('validating') || lower.includes('checking')) return 3;
    if (lower.includes('parsing') || lower.includes('extracting') || lower.includes('transform_persona') || lower.includes('transform_questions')) return 2;
  }
  // If we have lines flowing but no specific marker, assume LLM generation
  if (lines.length > 2) return 1;
  // Very early — prompt assembly
  return 0;
}

// ── Elapsed timer hook ───────────────────────────────────────────

function useElapsedSeconds(isRunning: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (!isRunning) return;
    startRef.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  return elapsed;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Main Component ───────────────────────────────────────────────

interface CompilationStepperProps {
  outputLines: string[];
  isRunning: boolean;
}

export function CompilationStepper({ outputLines, isRunning }: CompilationStepperProps) {
  const activeIndex = useMemo(() => inferStageIndex(outputLines), [outputLines]);
  const elapsed = useElapsedSeconds(isRunning);

  return (
    <div className="space-y-1.5">
      {/* Stepper track */}
      <div className="flex items-center gap-0.5">
        {COMPILATION_STAGES.map((stage, i) => {
          const isCompleted = i < activeIndex;
          const isActive = i === activeIndex && isRunning;

          return (
            <div key={stage.stage} className="flex items-center gap-0.5 flex-1 last:flex-initial">
              {/* Step indicator */}
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="relative flex items-center justify-center w-5 h-5 shrink-0">
                  {isCompleted ? (
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center"
                    >
                      <Check className="w-3 h-3 text-emerald-400" />
                    </motion.div>
                  ) : isActive ? (
                    <>
                      <motion.div
                        className="absolute w-5 h-5 rounded-full bg-primary/20"
                        animate={{ scale: [1, 1.5, 1], opacity: [0.4, 0, 0.4] }}
                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                      />
                      <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                    </>
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-secondary/40" />
                  )}
                </div>

                <span
                  className={`text-xs font-medium truncate transition-colors duration-300 ${
                    isActive
                      ? 'text-foreground/80'
                      : isCompleted
                        ? 'text-emerald-400/70'
                        : 'text-muted-foreground/40'
                  }`}
                >
                  {stage.label}
                </span>
              </div>

              {/* Connector line */}
              {i < COMPILATION_STAGES.length - 1 && (
                <div className="flex-1 h-px mx-0.5 min-w-2">
                  <motion.div
                    className="h-full rounded-full"
                    initial={false}
                    animate={{
                      backgroundColor: isCompleted
                        ? 'rgba(52, 211, 153, 0.4)'
                        : 'rgba(148, 163, 184, 0.15)',
                    }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Active stage description + elapsed timer */}
      {isRunning && COMPILATION_STAGES[activeIndex] && (
        <motion.div
          key={activeIndex}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="flex items-center justify-between px-0.5"
        >
          <span className="text-xs text-muted-foreground/50">
            {COMPILATION_STAGES[activeIndex]!.description}
          </span>
          <span className="text-xs tabular-nums font-mono text-muted-foreground/40 shrink-0 ml-2">
            {formatElapsed(elapsed)}
          </span>
        </motion.div>
      )}
    </div>
  );
}
