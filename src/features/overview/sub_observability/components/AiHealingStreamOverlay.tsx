import { useRef, useEffect, useState, useCallback } from 'react';
import { Stethoscope, Search, Wrench, CheckCircle2, XCircle, ChevronDown, ChevronUp, X } from 'lucide-react';
import type { AiHealingState, AiHealingPhase } from '@/hooks/execution/useAiHealingStream';
import { useTranslation } from '@/i18n/useTranslation';

function useElapsedTime(active: boolean): number {
  const startRef = useRef<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const rafRef = useRef<number | null>(null);

  const tick = useCallback(() => {
    if (startRef.current !== null) {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (active) {
      if (startRef.current === null) startRef.current = Date.now();
      rafRef.current = requestAnimationFrame(tick);
    } else {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      // Keep the final elapsed value visible after completion; only
      // reset if no timer was ever started (idle -> idle transition).
      if (startRef.current === null) setElapsed(0);
    }
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [active, tick]);

  return elapsed;
}

const PHASE_STEPS: { phase: AiHealingPhase; label: string; icon: typeof Search }[] = [
  { phase: 'diagnosing', label: 'Diagnosing', icon: Search },
  { phase: 'applying', label: 'Applying Fixes', icon: Wrench },
  { phase: 'completed', label: 'Completed', icon: CheckCircle2 },
];

function phaseIndex(phase: AiHealingPhase): number {
  if (phase === 'started' || phase === 'diagnosing') return 0;
  if (phase === 'applying') return 1;
  if (phase === 'completed') return 2;
  if (phase === 'failed') return 3;
  return -1;
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
  const logRef = useRef<HTMLDivElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const activeIdx = phaseIndex(healing.phase);
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
    <div className="rounded-xl border border-primary/10 bg-secondary/20 shadow-elevation-2 overflow-hidden animate-fade-slide-in">
      {/* Header bar */}
      <div className={`flex items-center justify-between px-4 py-3 border-b ${styles.border} ${styles.bg}`}>
        <div className="flex items-center gap-3">
          <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${styles.iconBox}`}>
            {isFailed ? (
              <XCircle className="w-3.5 h-3.5 text-red-400" />
            ) : isDone ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Stethoscope className="w-3.5 h-3.5 text-cyan-400 animate-pulse" />
            )}
          </div>
          <span className="typo-heading text-foreground/90 uppercase tracking-widest typo-body">
            AI Healing {isFailed ? 'Failed' : isDone ? 'Complete' : 'In Progress'}
          </span>
          {isDone && elapsed > 0 && (
            <span className="typo-caption text-muted-foreground/50">{elapsed}s</span>
          )}
          {!isDone && (
            <div className="w-3.5 h-3.5 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/50 transition-colors"
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
          {isDone && (
            <button
              onClick={onDismiss}
              className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/50 transition-colors"
              title={t.common.dismiss}
            >
              <X className="w-3.5 h-3.5" />
            </button>
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
                dotClass = 'bg-secondary/40 border-primary/15 text-muted-foreground/40';
                labelClass = 'text-muted-foreground/40';
              }

              return (
                <div key={step.phase} className="flex items-center gap-2">
                  {i > 0 && (
                    <div className={`w-6 h-px ${isPast || (isDone && i <= activeIdx) ? 'bg-emerald-500/40' : 'bg-primary/10'}`} />
                  )}
                  <div className="flex flex-col items-start gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <div className={`w-6 h-6 rounded-lg border flex items-center justify-center transition-colors ${dotClass} ${isCurrent ? 'animate-pulse' : ''}`}>
                        <Icon className="w-3 h-3" />
                      </div>
                      <span className={`typo-caption font-medium tracking-wide ${labelClass}`}>
                        {step.label}
                      </span>
                    </div>
                    {isCurrent && elapsed > 0 && (
                      <span className="typo-caption text-muted-foreground/50 ml-[30px]">{elapsed}s</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Diagnosis summary */}
          {healing.diagnosis && (
            <div className="px-3 py-2 rounded-lg bg-cyan-500/5 border border-cyan-500/15 typo-body text-cyan-300/90">
              <span className="font-medium text-cyan-400">Diagnosis:</span> {healing.diagnosis}
            </div>
          )}

          {/* Fixes applied */}
          {healing.fixesApplied.length > 0 && (
            <div className="px-3 py-2 rounded-lg bg-emerald-500/5 border border-emerald-500/15 typo-body space-y-1">
              <span className="font-medium text-emerald-400 typo-caption uppercase tracking-wider">Fixes Applied</span>
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
              <div className="absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-secondary/80 to-transparent backdrop-blur-sm z-10 rounded-t-lg pointer-events-none" />
              <div
                ref={logRef}
                className="max-h-48 overflow-y-auto rounded-lg bg-background/60 border border-primary/10 p-3 typo-code leading-relaxed text-muted-foreground/80 scroll-smooth"
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
