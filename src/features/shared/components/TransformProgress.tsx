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

// ── Shared line classification ──

type LineStyle = 'error' | 'system' | 'success' | 'marker' | 'default';

const LINE_STYLES: Record<LineStyle, { text: string; dot: string }> = {
  error:   { text: 'text-red-400/80',     dot: 'bg-red-400' },
  system:  { text: 'text-amber-400/70',   dot: 'bg-amber-400' },
  success: { text: 'text-emerald-400/80', dot: 'bg-emerald-400' },
  marker:  { text: 'text-cyan-300/80',    dot: 'bg-cyan-400' },
  default: { text: 'text-blue-400/80',    dot: 'bg-blue-400/40' },
};

function classifyLine(line: string): LineStyle {
  const lower = line.toLowerCase();
  // Markers (transform protocol lines) — show as cyan, not red
  if (lower.includes('transform_questions') || lower.includes('transform_persona') || lower.includes('[milestone]')) return 'marker';
  if (lower.includes('error') || lower.includes('failed') || lower.includes('failure') || lower.includes('[warn]')) return 'error';
  if (lower.includes('[system]') || lower.includes('starting') || lower.includes('initializing')) return 'system';
  if (lower.includes('complete') || lower.includes('success') || lower.includes('finished') || lower.includes('done') || lower.includes('✓')) return 'success';
  return 'default';
}

// ── Transform mode phases (5 phases for n8n/adopt workflow) ──

type PhaseIconComponent = React.ComponentType<{ className?: string }>;

interface TransformPhase {
  keywords: string[];
  label: string;
  icon: PhaseIconComponent;
}

const TRANSFORM_PHASES: TransformPhase[] = [
  { keywords: ['parsing', 'static workflow', 'reading workflow', 'nodes found'], label: 'Parsing workflow structure', icon: FileJson },
  { keywords: ['preparing', 'transformation prompt', 'building prompt', 'claude'], label: 'Preparing transformation', icon: Settings },
  { keywords: ['generating', 'persona', 'ai is', 'processing', 'claude cli', 'thinking'], label: 'AI generating persona draft', icon: Sparkles },
  { keywords: ['extracting', 'output received', 'json', 'draft', 'parsing result'], label: 'Extracting persona structure', icon: Code },
  { keywords: ['complete', 'success', 'finished', 'done', 'ready', '✓'], label: 'Draft ready for review', icon: CheckCircle2 },
];

function detectTransformPhase(lines: string[], streamPhase: CliRunPhase): { step: number; total: number; label: string; Icon: PhaseIconComponent } | null {
  if (lines.length === 0) return null;

  let lastMatchedIndex = -1;
  const maxIndex = streamPhase === 'running' ? TRANSFORM_PHASES.length - 2 : TRANSFORM_PHASES.length - 1;

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

  if (lastMatchedIndex === -1) {
    return { step: 1, total: TRANSFORM_PHASES.length, label: 'Analyzing workflow...', Icon: FileJson };
  }
  const matched = TRANSFORM_PHASES[lastMatchedIndex]!;
  return { step: lastMatchedIndex + 1, total: TRANSFORM_PHASES.length, label: matched.label, Icon: matched.icon };
}

// ── Analysis mode phases (7 phases for design analysis) ──

const ANALYSIS_PHASES = [
  { keywords: ['[system]', 'starting', 'initializing', 'design analysis started'], label: 'Initializing analysis' },
  { keywords: ['analyzing prompt', 'prompt structure', 'reading prompt', 'parsing'], label: 'Analyzing prompt structure' },
  { keywords: ['identity', 'role', 'persona', 'instructions'], label: 'Evaluating agent identity' },
  { keywords: ['tool', 'function', 'generating tool', 'suggest'], label: 'Recommending tools and triggers' },
  { keywords: ['trigger', 'event', 'schedule', 'channel', 'notification', 'connector'], label: 'Configuring integrations' },
  { keywords: ['feasibility', 'testing', 'validat', 'check'], label: 'Testing feasibility' },
  { keywords: ['summary', 'highlight', 'finaliz', 'complete', 'finished', 'done', '✓'], label: 'Finalizing design' },
] as const;

function detectAnalysisPhase(lines: string[]): { step: number; total: number; label: string } | null {
  if (lines.length === 0) return null;

  let lastMatchedIndex = -1;
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (let i = ANALYSIS_PHASES.length - 1; i > lastMatchedIndex; i--) {
      const p = ANALYSIS_PHASES[i];
      if (p && p.keywords.some((kw) => lower.includes(kw))) {
        lastMatchedIndex = i;
        break;
      }
    }
  }

  if (lastMatchedIndex === -1) return null;
  const matched = ANALYSIS_PHASES[lastMatchedIndex];
  if (!matched) return null;
  return { step: lastMatchedIndex + 1, total: ANALYSIS_PHASES.length, label: matched.label };
}

// ── Component ──

export interface TransformProgressProps {
  lines: string[];
  /** 'transform' = full panel (n8n/adopt wizard). 'analysis' = compact terminal (design review). */
  mode?: 'transform' | 'analysis';
  // transform mode
  phase?: CliRunPhase;
  runId?: string | null;
  isRestoring?: boolean;
  onRetry?: () => void;
  onCancel?: () => void;
  // analysis mode
  isRunning?: boolean;
}

export function TransformProgress({
  lines,
  mode = 'transform',
  phase = 'idle',
  runId,
  isRestoring,
  onRetry,
  onCancel,
  isRunning = false,
}: TransformProgressProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  // Start expanded so users can see the CLI output immediately
  const [showTerminal, setShowTerminal] = useState(true);

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

  const transformPhase = useMemo(
    () => (mode === 'transform' && (phase === 'running' || phase === 'completed') ? detectTransformPhase(lines, phase) : null),
    [lines, phase, mode],
  );

  const analysisPhase = useMemo(
    () => (mode === 'analysis' && isRunning ? detectAnalysisPhase(lines) : null),
    [lines, isRunning, mode],
  );

  // Shared terminal body
  const terminalBody = (
    <div
      ref={terminalRef}
      onScroll={handleTerminalScroll}
      className="max-h-[200px] overflow-y-auto font-mono text-sm bg-background"
    >
      {lines.length === 0 ? (
        <div className="p-4 text-muted-foreground/80 text-center text-sm">No output yet...</div>
      ) : (
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
      )}
    </div>
  );

  // ── Analysis mode (compact terminal with phase header) ──
  if (mode === 'analysis') {
    return (
      <div className="border border-primary/15 rounded-2xl overflow-hidden bg-background shadow-[0_0_15px_rgba(0,0,0,0.2)]">
        <AnimatePresence mode="wait">
          {isRunning && analysisPhase && (
            <motion.div
              key={analysisPhase.step}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15 }}
              className="flex items-center gap-3 px-4 py-2 bg-blue-500/5 border-b border-blue-500/10"
            >
              <span className="text-sm font-mono text-blue-400/60 shrink-0">
                Step {analysisPhase.step} of {analysisPhase.total}
              </span>
              <div className="flex-1 h-1 rounded-full bg-secondary/30 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-blue-400/40"
                  initial={{ width: 0 }}
                  animate={{ width: `${(analysisPhase.step / analysisPhase.total) * 100}%` }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                />
              </div>
              <span className="text-sm text-blue-400/80 truncate">{analysisPhase.label}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          onClick={() => setShowTerminal(!showTerminal)}
          className="flex items-center justify-between w-full px-4 py-2 bg-primary/5 border-b border-primary/10 cursor-pointer hover:bg-secondary/50 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            {showTerminal ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/90" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/90" />
            )}
            <span className="text-sm text-muted-foreground/90 font-mono">
              {isRunning ? (
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  {analysisPhase ? analysisPhase.label : 'Analyzing...'}
                </span>
              ) : (
                'Complete'
              )}
            </span>
          </div>
          <span className="text-sm text-muted-foreground/80 font-mono">{lines.length} lines</span>
        </button>

        {showTerminal && terminalBody}
      </div>
    );
  }

  // ── Transform mode (full panel with status header) ──
  const progressPercent = transformPhase ? (transformPhase.step / transformPhase.total) * 100 : 0;
  const PhaseIcon = transformPhase?.Icon ?? Sparkles;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-primary/10 bg-secondary/20 overflow-hidden">
        <div className="p-5">
          {phase === 'running' && (
            <div className="space-y-3">
              {isRestoring && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400/70" />
                  <span className="text-sm text-amber-400/80">Resuming previous transformation session...</span>
                </motion.div>
              )}

              <div className="flex items-center gap-4">
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
                      key={transformPhase?.label ?? 'processing'}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                      className="text-sm font-medium text-foreground/80"
                    >
                      {transformPhase?.label ?? 'Starting transformation...'}
                    </motion.p>
                  </AnimatePresence>
                  <p className="text-sm text-muted-foreground/80 mt-0.5">
                    {transformPhase ? `Step ${transformPhase.step} of ${transformPhase.total}` : 'Starting...'}
                  </p>

                  <div className="mt-3 h-1.5 rounded-full bg-secondary/40 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-violet-500/60 to-violet-400/40"
                      initial={{ width: 0 }}
                      animate={{ width: `${progressPercent}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>

                  <p className="text-sm text-muted-foreground/90 mt-2">
                    You can continue working — we'll notify you when the draft is ready.
                  </p>
                </div>

                {onCancel && (
                  <button
                    onClick={onCancel}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border border-red-500/20 text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors flex-shrink-0"
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
                <p className="text-sm text-muted-foreground/80 mt-0.5">
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
                <p className="text-sm text-red-400/60 mt-0.5">Check the output below for details.</p>
              </div>
              {onRetry && (
                <button
                  onClick={onRetry}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl border border-violet-500/25 text-violet-300 hover:bg-violet-500/15 transition-colors"
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
                <Sparkles className="w-6 h-6 text-muted-foreground/80" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground/90">Waiting to start transformation...</p>
                <p className="text-sm text-muted-foreground/80 mt-0.5">
                  Click "Generate Persona Draft" to begin.
                </p>
              </div>
            </div>
          )}
        </div>

        {lines.length > 0 && (
          <>
            <button
              onClick={() => setShowTerminal(!showTerminal)}
              className="flex items-center justify-between w-full px-5 py-2 bg-primary/5 border-t border-primary/10 cursor-pointer hover:bg-secondary/40 transition-colors"
            >
              <div className="flex items-center gap-2.5">
                {showTerminal ? (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/80" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/80" />
                )}
                <span className="text-sm text-muted-foreground/80 font-mono">
                  {showTerminal ? 'Hide' : 'Show'} CLI output
                </span>
              </div>
              <div className="flex items-center gap-2">
                {runId && (
                  <span className="text-sm text-muted-foreground/80 font-mono">{runId.slice(0, 8)}</span>
                )}
                <span className="text-sm text-muted-foreground/80 font-mono">{lines.length} lines</span>
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
                  {terminalBody}
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}
