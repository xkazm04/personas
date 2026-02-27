import { useMemo, useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Loader2, Check, Circle, Clock } from 'lucide-react';
import { useStepProgress } from '@/hooks/useStepProgress';

interface AnalyzingPhaseProps {
  outputLines: string[];
  onCancel: () => void;
}

const STAGE_DEFS = [
  { label: 'Connecting', description: 'Establishing connection to AI' },
  { label: 'Analyzing requirements', description: 'Identifying authentication patterns' },
  { label: 'Designing connector', description: 'Generating fields and validation rules' },
  { label: 'Generating healthcheck', description: 'Building test endpoint configuration' },
] as const;

/** Map raw backend output lines to a stage index (0–4). */
function deriveStageIndex(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.toLowerCase();
    if (l.includes('analysis complete') || l.includes('designed successfully')) return 4; // all done
    if (l.includes('designing connector') || l.includes('researching')) return 3;
    if (l.includes('analyzing service') || l.includes('analyzing requirement')) return 2;
    if (l.includes('connected')) return 1;
  }
  return 0;
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function AnalyzingPhase({ outputLines, onCancel }: AnalyzingPhaseProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const derivedIdx = useMemo(() => deriveStageIndex(outputLines), [outputLines]);

  const sp = useStepProgress(STAGE_DEFS.length);

  // Drive step progress from derived index
  useEffect(() => {
    sp.setDerivedIndex(derivedIdx);
  }, [derivedIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Latest meaningful line for detail text
  const latestLine = outputLines.length > 0 ? outputLines[outputLines.length - 1] : null;

  // Progress: use derived index directly against total (4) for smooth 0→100
  const progress = Math.min((derivedIdx / STAGE_DEFS.length) * 100, 100);

  return (
    <motion.div
      key="analyzing"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      {/* Time estimate + elapsed */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground/80">
          <Clock className="w-3 h-3" />
          <span>{formatElapsed(elapsed)} elapsed</span>
        </div>
        <span className="text-sm text-muted-foreground/80">Typically 15–30 seconds</span>
      </div>

      {/* Progress bar */}
      <div className="h-1 rounded-full bg-primary/10 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={{ width: '0%' }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>

      {/* Stage indicators */}
      <div className="space-y-1 px-1">
        {sp.steps.map((step, i) => {
          const def = STAGE_DEFS[i]!;
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.2, delay: i * 0.05 }}
              className="flex items-center gap-3 py-1.5"
            >
              {/* Status icon */}
              <div className="w-5 h-5 flex items-center justify-center shrink-0">
                {step.status === 'completed' ? (
                  <div className="w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center">
                    <Check className="w-3 h-3 text-emerald-400" />
                  </div>
                ) : step.status === 'active' ? (
                  <Loader2 className="w-4 h-4 text-primary animate-spin" />
                ) : (
                  <Circle className="w-3.5 h-3.5 text-muted-foreground/20" />
                )}
              </div>
              {/* Label + description */}
              <div className="flex-1 min-w-0">
                <span className={`text-sm font-medium ${
                  step.status === 'completed'
                    ? 'text-muted-foreground/90'
                    : step.status === 'active'
                      ? 'text-foreground'
                      : 'text-muted-foreground/80'
                }`}>
                  {def.label}
                </span>
                {step.status === 'active' && (
                  <span className="ml-2 text-sm text-muted-foreground/90">{def.description}</span>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Latest output detail */}
      {latestLine && (
        <div className="px-3 py-2 rounded-xl bg-secondary/30 border border-primary/10 text-sm text-muted-foreground/80 font-mono truncate">
          {latestLine}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/90 rounded-xl text-sm transition-colors"
          data-testid="analyzing-cancel-btn"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}
