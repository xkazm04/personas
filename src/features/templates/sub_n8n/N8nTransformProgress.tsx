import { useMemo, useRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileJson,
  Settings,
  Sparkles,
  Code,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  XCircle,
  RotateCcw,
} from 'lucide-react';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';

// ── Phase detection ──

type PhaseIconComponent = React.ComponentType<{ className?: string }>;

interface TransformPhase {
  keywords: string[];
  label: string;
  icon: PhaseIconComponent;
}

const TRANSFORM_PHASES: TransformPhase[] = [
  {
    keywords: ['parsing', 'static workflow', 'reading workflow', 'nodes found'],
    label: 'Parsing workflow structure',
    icon: FileJson,
  },
  {
    keywords: ['preparing', 'transformation prompt', 'building prompt', 'claude'],
    label: 'Preparing transformation',
    icon: Settings,
  },
  {
    keywords: ['generating', 'persona', 'ai is', 'processing', 'claude cli', 'thinking'],
    label: 'AI generating persona draft',
    icon: Sparkles,
  },
  {
    keywords: ['extracting', 'output received', 'json', 'draft', 'parsing result'],
    label: 'Extracting persona structure',
    icon: Code,
  },
  {
    keywords: ['complete', 'success', 'finished', 'done', 'ready', '✓'],
    label: 'Draft ready for review',
    icon: CheckCircle2,
  },
];

function detectTransformPhase(lines: string[], streamPhase: CliRunPhase): { step: number; total: number; label: string; Icon: PhaseIconComponent } | null {
  if (lines.length === 0) return null;

  let lastMatchedIndex = -1;

  // While still running, cap at Phase 4 — Phase 5 ("Draft ready") should only
  // show once the backend status actually transitions to 'completed'.
  const maxIndex = streamPhase === 'running'
    ? TRANSFORM_PHASES.length - 2
    : TRANSFORM_PHASES.length - 1;

  for (const line of lines) {
    const lower = line.toLowerCase();
    for (let i = Math.min(maxIndex, TRANSFORM_PHASES.length - 1); i > lastMatchedIndex; i--) {
      const phase = TRANSFORM_PHASES[i];
      if (phase && phase.keywords.some((kw) => lower.includes(kw))) {
        lastMatchedIndex = i;
        break;
      }
    }
  }

  if (lastMatchedIndex === -1) return null;
  const matched = TRANSFORM_PHASES[lastMatchedIndex]!;
  return { step: lastMatchedIndex + 1, total: TRANSFORM_PHASES.length, label: matched.label, Icon: matched.icon };
}

// ── Line classification (matching DesignTerminal) ──

type LineStyle = 'error' | 'system' | 'success' | 'default';

const LINE_STYLES: Record<LineStyle, { text: string; dot: string }> = {
  error:   { text: 'text-red-400/80',     dot: 'bg-red-400' },
  system:  { text: 'text-amber-400/70',   dot: 'bg-amber-400' },
  success: { text: 'text-emerald-400/80', dot: 'bg-emerald-400' },
  default: { text: 'text-blue-400/80',    dot: 'bg-blue-400/40' },
};

function classifyLine(line: string): LineStyle {
  const lower = line.toLowerCase();
  if (lower.includes('error') || lower.includes('failed') || lower.includes('failure')) return 'error';
  if (lower.includes('[system]') || lower.includes('starting') || lower.includes('initializing')) return 'system';
  if (lower.includes('complete') || lower.includes('success') || lower.includes('finished') || lower.includes('✓')) return 'success';
  return 'default';
}

// ── Component ──

interface N8nTransformProgressProps {
  phase: CliRunPhase;
  lines: string[];
  runId: string | null;
  isRestoring?: boolean;
  onRetry?: () => void;
  onCancel?: () => void;
}

export function N8nTransformProgress({ phase, lines, runId, isRestoring, onRetry, onCancel }: N8nTransformProgressProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const [showTerminal, setShowTerminal] = useState(false);

  const currentPhase = useMemo(
    () => (phase === 'running' || phase === 'completed' ? detectTransformPhase(lines, phase) : null),
    [lines, phase],
  );

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current && shouldAutoScroll.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  const handleTerminalScroll = () => {
    if (terminalRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = terminalRef.current;
      shouldAutoScroll.current = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
    }
  };

  // Auto-expand terminal on failure
  useEffect(() => {
    if (phase === 'failed') setShowTerminal(true);
  }, [phase]);

  const progressPercent = currentPhase ? (currentPhase.step / currentPhase.total) * 100 : 0;
  const PhaseIcon = currentPhase?.Icon ?? Sparkles;

  return (
    <div className="space-y-4">
      {/* Main progress panel */}
      <div className="rounded-2xl border border-primary/10 bg-secondary/20 overflow-hidden">
        {/* Progress header */}
        <div className="p-5">
          {phase === 'running' && (
            <div className="space-y-3">
              {/* Restore banner */}
              {isRestoring && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400/70" />
                  <span className="text-xs text-amber-400/80">Resuming previous transformation session...</span>
                </motion.div>
              )}

              <div className="flex items-center gap-4">
                {/* Animated phase icon */}
                <div className="relative flex-shrink-0">
                  <motion.div
                    className="absolute inset-0 w-12 h-12 rounded-xl bg-violet-500/15"
                    animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <div className="w-12 h-12 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                    <PhaseIcon className="w-6 h-6 text-violet-400" />
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={currentPhase?.label ?? 'processing'}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                      className="text-sm font-medium text-foreground/80"
                    >
                      {currentPhase?.label ?? 'Processing workflow...'}
                    </motion.p>
                  </AnimatePresence>
                  <p className="text-xs text-muted-foreground/40 mt-0.5">
                    {currentPhase
                      ? `Step ${currentPhase.step} of ${currentPhase.total}`
                      : 'Initializing...'}
                  </p>

                  {/* Progress bar */}
                  <div className="mt-3 h-1.5 rounded-full bg-secondary/40 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-violet-500/60 to-violet-400/40"
                      initial={{ width: 0 }}
                      animate={{ width: `${progressPercent}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>

                  <p className="text-[11px] text-muted-foreground/50 mt-2">
                    You can continue working — we'll notify you when the draft is ready.
                  </p>
                </div>

                {/* Cancel button */}
                {onCancel && (
                  <button
                    onClick={onCancel}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border border-red-500/20 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors flex-shrink-0"
                    title="Cancel transformation"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                )}
              </div>
            </div>
          )}

          {phase === 'completed' && (
            <div className="flex items-center gap-4">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', damping: 12, stiffness: 300 }}
                className="w-12 h-12 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center"
              >
                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              </motion.div>
              <div>
                <p className="text-sm font-medium text-emerald-400">Draft generated successfully</p>
                <p className="text-xs text-muted-foreground/40 mt-0.5">
                  Your persona draft is ready for review and editing.
                </p>
              </div>
            </div>
          )}

          {phase === 'failed' && (
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-red-400">Transformation failed</p>
                <p className="text-xs text-red-400/60 mt-0.5">
                  Check the output below for details.
                </p>
              </div>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-xl border border-violet-500/25 text-violet-300 hover:bg-violet-500/15 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry
                </button>
              )}
            </div>
          )}

          {phase === 'idle' && (
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-secondary/40 border border-primary/10 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-muted-foreground/30" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground/50">Waiting to start transformation...</p>
                <p className="text-xs text-muted-foreground/30 mt-0.5">
                  Click "Generate Persona Draft" to begin.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Collapsible terminal output */}
        {lines.length > 0 && (
          <>
            <button
              onClick={() => setShowTerminal(!showTerminal)}
              className="flex items-center justify-between w-full px-5 py-2 bg-primary/5 border-t border-primary/10 cursor-pointer hover:bg-secondary/40 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                {showTerminal ? (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40" />
                )}
                <span className="text-[11px] text-muted-foreground/40 font-mono">
                  {showTerminal ? 'Hide' : 'Show'} CLI output
                </span>
              </div>
              <div className="flex items-center gap-2">
                {runId && (
                  <span className="text-[10px] text-muted-foreground/25 font-mono">
                    {runId.slice(0, 8)}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground/30 font-mono">
                  {lines.length} lines
                </span>
              </div>
            </button>

            <AnimatePresence>
              {showTerminal && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <div
                    ref={terminalRef}
                    onScroll={handleTerminalScroll}
                    className="max-h-[200px] overflow-y-auto font-mono text-xs bg-background"
                  >
                    <div className="p-3">
                      {lines.map((line, index) => {
                        const style = classifyLine(line);
                        const colors = LINE_STYLES[style];
                        return (
                          <div key={index} className="flex items-start gap-2 py-px">
                            <span className="text-muted-foreground/20 select-none flex-shrink-0 w-8 text-right">
                              {(index + 1).toString().padStart(3, ' ')}
                            </span>
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-[5px] ${colors.dot}`} />
                            <span className={`${colors.text} break-all`}>{line}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}
