import { useMemo, useState, useEffect, useRef } from 'react';
import { Check, Circle, Clock } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useStepProgress } from '@/hooks/useStepProgress';
import { formatElapsed as _formatElapsed } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

interface AnalyzingPhaseProps {
  outputLines: string[];
  onCancel: () => void;
}

const STAGE_KEYS = ['step_connecting', 'step_analyzing', 'step_designing', 'step_healthcheck'] as const;

/** Map raw backend output lines to a stage index (0--4). */
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

const formatElapsed = (seconds: number) => _formatElapsed(seconds, { unit: 's' });

export function AnalyzingPhase({ outputLines, onCancel }: AnalyzingPhaseProps) {
  const { t } = useTranslation();
  const stageDefs = useMemo(() => STAGE_KEYS.map((key) => ({
    label: t.vault.design_phases[key] as string,
    description: t.vault.design_phases[`${key}_desc` as keyof typeof t.vault.design_phases] as string,
  })), [t]);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const derivedIdx = useMemo(() => deriveStageIndex(outputLines), [outputLines]);

  const sp = useStepProgress(STAGE_KEYS.length);

  // Drive step progress from derived index
  useEffect(() => {
    sp.setDerivedIndex(derivedIdx);
  }, [derivedIdx]);

  // Last 3 output lines for the scrollable status region
  const tailLines = outputLines.slice(-3);
  const tailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tailRef.current?.scrollTo({ top: tailRef.current.scrollHeight, behavior: 'smooth' });
  }, [outputLines.length]);

  // Progress: use derived index directly against total (4) for smooth 0->100
  const progress = Math.min((derivedIdx / STAGE_KEYS.length) * 100, 100);

  return (
    <div
      key="analyzing"
      className="animate-fade-slide-in space-y-4"
    >
      {/* Time estimate + elapsed (hidden for first 5s to reduce anxiety) */}
      <div className="flex items-center justify-between px-1">
        {elapsed >= 5 ? (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground/80">
            <Clock className="w-3 h-3" />
            <span>{formatElapsed(elapsed)} elapsed</span>
          </div>
        ) : (
          <div />
        )}
        <span className="text-sm text-muted-foreground/80">{t.vault.design_phases.typical_time}</span>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-primary/10 overflow-hidden">
        <div
          className="animate-fade-in h-full rounded-full bg-primary" style={{ width: `${progress}%` }}
        />
      </div>

      {/* Stage indicators */}
      <div className="space-y-1 px-1" aria-live="polite" aria-atomic="false">
        {sp.steps.map((step, i) => {
          const def = stageDefs[i]!;
          return (
            <div
              key={i}
              className="animate-fade-slide-in flex items-center gap-3 py-1.5"
            >
              {/* Status icon */}
              <div className="w-5 h-5 flex items-center justify-center shrink-0">
                {step.status === 'completed' ? (
                  <div className="w-5 h-5 rounded-full bg-emerald-500/15 flex items-center justify-center">
                    <Check className="w-3 h-3 text-emerald-400" />
                  </div>
                ) : step.status === 'active' ? (
                  <LoadingSpinner className="text-primary" />
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
            </div>
          );
        })}
      </div>

      {/* Latest output detail (scrollable, up to 3 lines) */}
      {tailLines.length > 0 && (
        <div
          ref={tailRef}
          className="px-3 hidden py-2 rounded-modal bg-secondary/30 border border-primary/10 text-sm text-muted-foreground/80 font-mono max-h-[4.5rem] overflow-y-auto"
        >
          {tailLines.map((line, i) => (
            <div key={outputLines.length - tailLines.length + i}>{line}</div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/90 rounded-modal text-sm transition-colors"
          data-testid="analyzing-cancel-btn"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
