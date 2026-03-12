import { ChevronDown, ChevronRight, Zap } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { formatElapsed } from '@/lib/utils/formatters';
import type { PhaseEntry } from '../runnerTypes';
import { PHASE_META } from '../runnerTypes';

/** Phase-aware halo color for tool-call dots. */
const PHASE_HALO: Record<string, string> = {
  initializing:  'bg-blue-400 shadow-[0_0_4px_rgba(59,130,246,0.5)]',
  thinking:      'bg-violet-400 shadow-[0_0_4px_rgba(139,92,246,0.5)]',
  calling_tools: 'bg-emerald-400 shadow-[0_0_4px_rgba(16,185,129,0.5)]',
  delegating:    'bg-cyan-400 shadow-[0_0_4px_rgba(6,182,212,0.5)]',
  responding:    'bg-indigo-400 shadow-[0_0_4px_rgba(99,102,241,0.5)]',
  finalizing:    'bg-teal-400 shadow-[0_0_4px_rgba(20,184,166,0.5)]',
  error:         'bg-red-400 shadow-[0_0_4px_rgba(239,68,68,0.5)]',
};

function phaseHaloColor(phaseId: string): string {
  return PHASE_HALO[phaseId] ?? 'bg-blue-400/70';
}

interface PhaseTimelineProps {
  phases: PhaseEntry[];
  isExecuting: boolean;
  elapsedMs: number;
  showPhases: boolean;
  onTogglePhases: () => void;
}

export function PhaseTimeline({
  phases,
  isExecuting,
  elapsedMs,
  showPhases,
  onTogglePhases,
}: PhaseTimelineProps) {
  if (phases.length === 0) return null;

  const durations = phases.map((p, j) => {
    const active = j === phases.length - 1 && isExecuting;
    return p.endMs != null ? p.endMs - p.startMs : active ? elapsedMs - p.startMs : 0;
  });
  const totalDur = durations.reduce((s, d) => s + d, 0);
  const minGrow = totalDur > 0 ? totalDur * 0.06 : 1;

  return (
    <div className="border-b border-border/20">
      <button
        onClick={onTogglePhases}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-sm font-mono text-muted-foreground/80 hover:text-muted-foreground transition-colors uppercase tracking-wider"
      >
        {showPhases ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Phases
      </button>
      <AnimatePresence>
        {showPhases && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2.5">
              <div className="flex w-full h-7 rounded-lg overflow-hidden gap-px" data-testid="phase-timeline-bar">
                {phases.map((phase, i) => {
                  const isActive = i === phases.length - 1 && isExecuting;
                  const meta = PHASE_META[phase.id];
                  const PhaseIcon = meta?.icon ?? Zap;
                  const duration = durations[i]!;

                  return (
                    <Tooltip content={`${phase.label}: ${formatElapsed(duration)}${phase.toolCalls.length > 0 ? ` -- ${phase.toolCalls.length} tool call${phase.toolCalls.length > 1 ? 's' : ''}` : ''}`} placement="bottom">
                    <motion.div
                      key={`${phase.id}-${i}`}
                      layout
                      className={`relative flex items-center justify-center gap-1.5 px-2 overflow-hidden transition-colors ${
                        isActive
                          ? 'bg-primary/20 text-primary/90'
                          : phase.id === 'error'
                            ? 'bg-red-500/15 text-red-400/80'
                            : 'bg-secondary/40 text-muted-foreground/80'
                      }`}
                      style={{ flexGrow: Math.max(duration, minGrow) }}
                    >
                      {isActive && (
                        <motion.div
                          className="absolute inset-0 pointer-events-none"
                          style={{
                            background: 'linear-gradient(90deg, transparent, hsl(var(--primary) / 0.12), transparent)',
                            width: '60%',
                          }}
                          animate={{ left: ['-60%', '100%'] }}
                          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                        />
                      )}
                      {/* Tool-call activity dots */}
                      {phase.toolCalls.length > 0 && duration > 0 && (
                        <div className="absolute inset-0 pointer-events-none z-[1]">
                          {phase.toolCalls.map((tc, j) => {
                            const offset = tc.startMs - phase.startMs;
                            const pct = Math.min(100, Math.max(0, (offset / duration) * 100));
                            const tcDuration = tc.endMs != null ? tc.endMs - tc.startMs : undefined;
                            return (
                              <Tooltip content={`${tc.toolName}${tcDuration != null ? `: ${formatElapsed(tcDuration)}` : ''}`} placement="bottom">
                                <span
                                  key={j}
                                  className={`absolute top-1/2 -translate-y-1/2 w-[5px] h-[5px] rounded-full ${phaseHaloColor(phase.id)} opacity-90`}
                                  style={{ left: `${pct}%` }}
                                  data-testid={`tool-dot-${i}-${j}`}
                                />
                              </Tooltip>
                            );
                          })}
                        </div>
                      )}
                      <PhaseIcon className="w-3 h-3 flex-shrink-0 relative z-[2]" />
                      <span className="truncate text-sm font-medium relative z-[2]">{phase.label}</span>
                      {duration > 0 && (
                        <span className="font-mono text-sm opacity-60 relative z-[2] flex-shrink-0">
                          {formatElapsed(duration)}
                        </span>
                      )}
                    </motion.div>
                    </Tooltip>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
