import { useRef, useEffect, useState } from 'react';
import { Stethoscope, Search, Wrench, CheckCircle2, XCircle, ChevronDown, ChevronUp, X } from 'lucide-react';
import type { AiHealingState, AiHealingPhase } from '@/hooks/execution/useAiHealingStream';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText } from '@/i18n/DebtText';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';


function useElapsedTime(active: boolean): number {
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // Tracks whether the previous render was active, so a completed -> started
  // transition (overlay stays mounted across sessions) starts a fresh clock
  // instead of carrying over the prior session's startRef.
  const wasActiveRef = useRef(false);

  useEffect(() => {
    if (active) {
      if (!wasActiveRef.current) {
        startRef.current = Date.now();
        setElapsed(0);
      }
      wasActiveRef.current = true;
      // A 1 Hz display only needs a 1 Hz clock; rAF fired ~60x/s for no
      // visible benefit and burned CPU during long heals.
      const id = setInterval(() => {
        if (startRef.current !== null) {
          setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
        }
      }, 1000);
      return () => clearInterval(id);
    }
    wasActiveRef.current = false;
    // Keep the final elapsed value visible after completion; only reset if
    // no timer was ever started (idle -> idle transition).
    if (startRef.current === null) setElapsed(0);
    return undefined;
  }, [active]);

  return elapsed;
}

const PHASE_STEPS = [
  { phase: 'diagnosing', labelKey: 'step_diagnosing', icon: Search },
  { phase: 'applying', labelKey: 'step_applying', icon: Wrench },
  { phase: 'completed', labelKey: 'step_completed', icon: CheckCircle2 },
] as const satisfies readonly { phase: AiHealingPhase; labelKey: string; icon: typeof Search }[];

function phaseIndex(phase: AiHealingPhase): number {
  if (phase === 'started' || phase === 'diagnosing') return 0;
  if (phase === 'applying') return 1;
  if (phase === 'completed') return 2;
  return -1;
}

/**
 * The step a run had reached. A failure is not a step of its own: it happened ON the step the
 * run was on, so that step is the failed one and the steps after it were never reached. The
 * failed phase used to sit at index 3, past every step, which drew all three - "Completed"
 * included - in the done tone on a run that failed.
 */
function useReachedStep(phase: AiHealingPhase): number {
  const idx = phaseIndex(phase);
  const [reached, setReached] = useState(Math.max(0, idx));
  useEffect(() => {
    if (idx >= 0) setReached(idx);
  }, [idx]);
  return idx >= 0 ? idx : reached;
}

const HEADER_STYLES: Record<string, { border: string; bg: string; iconBox: string }> = {
  red: {
    border: 'border-red-500/20',
    bg: 'bg-gradient-to-r from-red-500/10 to-transparent',
    iconBox: 'bg-red-500/15 border-red-500/25',
  },
  emerald: {
    border: 'border-emerald-500/20',
    bg: 'bg-gradient-to-r from-emerald-500/10 to-transparent',
    iconBox: 'bg-emerald-500/15 border-emerald-500/25',
  },
  amber: {
    border: 'border-amber-500/20',
    bg: 'bg-gradient-to-r from-amber-500/10 to-transparent',
    iconBox: 'bg-amber-500/15 border-amber-500/25',
  },
  cyan: {
    border: 'border-cyan-500/20',
    bg: 'bg-gradient-to-r from-cyan-500/10 to-transparent',
    iconBox: 'bg-cyan-500/15 border-cyan-500/25',
  },
};

function phaseColor(phase: AiHealingPhase): string {
  if (phase === 'failed') return 'red';
  if (phase === 'completed') return 'emerald';
  if (phase === 'applying') return 'amber';
  return 'cyan';
}

interface AiHealingStreamOverlayProps {
  healing: AiHealingState;
  onDismiss: () => void;
}

export function AiHealingStreamOverlay({ healing, onDismiss }: AiHealingStreamOverlayProps) {
  const { t } = useTranslation();
  const o = t.overview.ai_healing_overlay;
  const logRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const activeIdx = useReachedStep(healing.phase);
  const color = phaseColor(healing.phase);
  const styles = HEADER_STYLES[color]!;
  const isFailed = healing.phase === 'failed';
  const isDone = healing.phase === 'completed' || isFailed;
  const isActive = healing.phase !== 'idle' && !isDone;
  const elapsed = useElapsedTime(isActive);

  // Auto-scroll log to bottom
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [healing.lines.length]);

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/20 shadow-elevation-2 overflow-hidden animate-fade-slide-in">
      {/* Header bar */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${styles.border} ${styles.bg}`}>
        <div className="flex items-center gap-3">
          <div className={`w-7 h-7 rounded-card border flex items-center justify-center ${styles.iconBox}`}>
            {isFailed ? (
              <XCircle className="w-3.5 h-3.5 text-red-400" />
            ) : isDone ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Stethoscope className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            )}
          </div>
          <span className="typo-heading text-foreground/90 uppercase typo-body">
            <DebtText k="auto_ai_healing_2ec57639" /> {isFailed ? o.status_failed : isDone ? o.status_complete : o.status_in_progress}
          </span>
          {isDone && elapsed > 0 && (
            <span className="typo-caption text-foreground">{elapsed}s</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Tooltip content={collapsed ? o.expand : o.collapse}>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setCollapsed((c) => !c)}
              aria-label={collapsed ? o.expand : o.collapse}
            >
              {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
            </Button>
          </Tooltip>
          {isDone && (
            <Tooltip content={t.common.dismiss}>
              <Button variant="ghost" size="icon-sm" onClick={onDismiss} aria-label={t.common.dismiss}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </Tooltip>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="px-4 py-3 space-y-3">
          {/* Phase stepper */}
          <div className="flex items-center gap-2">
            {PHASE_STEPS.map((step, i) => {
              const Icon = step.icon;
              const isActive = activeIdx === i;
              const isPast = activeIdx > i;
              const isCurrent = isActive && !isDone;

              let dotClass: string;
              let labelClass: string;
              const stepState = isFailed && isActive ? 'failed' : isPast || (isDone && isActive) ? 'done' : isCurrent ? 'current' : 'pending';
              if (isFailed && isActive) {
                dotClass = 'bg-red-500/20 border-red-500/40 text-red-400';
                labelClass = 'text-red-400';
              } else if (isPast || (isDone && isActive)) {
                dotClass = 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400';
                labelClass = 'text-emerald-400';
              } else if (isCurrent) {
                dotClass = 'bg-cyan-500/20 border-cyan-500/40 text-cyan-400';
                labelClass = 'text-cyan-300';
              } else {
                dotClass = 'bg-secondary/40 border-primary/15 text-foreground';
                labelClass = 'text-foreground';
              }

              return (
                <div key={step.phase} className="flex items-center gap-2" data-step-state={stepState}>
                  {i > 0 && (
                    <div className={`w-6 h-px ${isPast || (isDone && i <= activeIdx) ? 'bg-emerald-500/40' : 'bg-primary/10'}`} />
                  )}
                  <div className="flex flex-col items-start gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-6 h-6 rounded-card border flex items-center justify-center transition-colors ${dotClass} ${isCurrent ? 'animate-pulse' : ''}`}>
                        <Icon className="w-3 h-3" />
                      </div>
                      <span className={`typo-caption tracking-wide ${labelClass}`}>
                        {o[step.labelKey]}
                      </span>
                    </div>
                    {isCurrent && elapsed > 0 && (
                      <span className="typo-caption text-foreground ml-[30px]">{elapsed}s</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Diagnosis summary */}
          {healing.diagnosis && (
            <div className="px-3 py-2 rounded-card bg-cyan-500/5 border border-cyan-500/15 typo-body text-cyan-300/90">
              <span className="font-medium text-cyan-400"><DebtText k="auto_diagnosis_d4ef703f" /></span> {healing.diagnosis}
            </div>
          )}

          {/* Fixes applied */}
          {healing.fixesApplied.length > 0 && (
            <div className="px-3 py-2 rounded-card bg-emerald-500/5 border border-emerald-500/15 typo-body space-y-1">
              <span className="text-emerald-400 typo-caption uppercase tracking-wider"><DebtText k="auto_fixes_applied_239ec9a7" /></span>
              {healing.fixesApplied.map((fix, i) => (
                <div key={i} className="flex items-start gap-2 text-emerald-300/80">
                  <CheckCircle2 className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span>{fix}</span>
                </div>
              ))}
            </div>
          )}

          {/* Streaming log output */}
          {healing.lines.length > 0 && (
            <div className="relative">
              {/* Frosted fade at top */}
              <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-secondary/80 to-transparent backdrop-blur-sm z-10 rounded-t-card pointer-events-none" />
              <div
                ref={logRef}
                className="max-h-48 overflow-y-auto rounded-card bg-background/60 border border-primary/10 p-3 typo-code text-foreground scroll-smooth"
              >
                {healing.lines.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-all">
                    {line}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
