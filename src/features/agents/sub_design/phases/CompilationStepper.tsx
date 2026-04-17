import { useState, useEffect, useRef, useMemo } from 'react';
import { Check } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { COMPILATION_STAGES } from '@/lib/compiler/personaCompiler';
import { formatElapsed as _formatElapsed } from '@/lib/utils/formatters';

// -- Stage inference from output lines ----------------------------

/**
 * Infer the active compilation stage index (0-4) from streaming output lines.
 *
 * The backend doesn't emit explicit stage events, so we use content heuristics:
 *   0 = prompt_assembly  -- initial lines, "starting", "initializing", "assembling"
 *   1 = llm_generation   -- once we see LLM output flowing (default while running)
 *   2 = result_parsing   -- "parsing", "extracting", "transform_persona", JSON markers
 *   3 = validation        -- "feasibility", "validating", "checking"
 *   4 = persist          -- "saving", "persisting", "writing"
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
  // Very early -- prompt assembly
  return 0;
}

// -- Elapsed timer hook -------------------------------------------

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

const formatElapsed = (seconds: number) => _formatElapsed(seconds, { unit: 's', format: 'clock' });

// -- Main Component -----------------------------------------------

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
                    <div
                      className="animate-fade-slide-in w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center"
                    >
                      <Check className="w-3 h-3 text-emerald-400" />
                    </div>
                  ) : isActive ? (
                    <>
                      <div
                        className="animate-fade-in absolute w-5 h-5 rounded-full bg-primary/20"
                      />
                      <LoadingSpinner size="sm" className="text-primary" />
                    </>
                  ) : (
                    <div className="w-2 h-2 rounded-full bg-secondary/40" />
                  )}
                </div>

                <span
                  className={`text-xs font-medium truncate transition-colors duration-300 ${
                    isActive
                      ? 'text-foreground'
                      : isCompleted
                        ? 'text-emerald-400/70'
                        : 'text-foreground'
                  }`}
                >
                  {stage.label}
                </span>
              </div>

              {/* Connector line */}
              {i < COMPILATION_STAGES.length - 1 && (
                <div className="flex-1 h-px mx-0.5 min-w-2">
                  <div
                    className="animate-fade-in h-full rounded-full"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Active stage description + elapsed timer */}
      {isRunning && COMPILATION_STAGES[activeIndex] && (
        <div
          key={activeIndex}
          className="animate-fade-slide-in flex items-center justify-between px-0.5"
        >
          <span className="text-xs text-foreground">
            {COMPILATION_STAGES[activeIndex]!.description}
          </span>
          <span className="text-xs tabular-nums font-mono text-foreground shrink-0 ml-2">
            {formatElapsed(elapsed)}
          </span>
        </div>
      )}
    </div>
  );
}
