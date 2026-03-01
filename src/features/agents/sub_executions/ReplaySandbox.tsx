import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronsLeft,
  ChevronsRight,
  DollarSign,
  Clock,
  Wrench,
  GitFork,
  Hash,
  Loader2,
  Terminal,
  X,
} from 'lucide-react';
import type { DbPersonaExecution } from '@/lib/types/types';
import { useReplayTimeline, type ToolCallStep } from '@/hooks/execution/useReplayTimeline';
import { usePersonaStore } from '@/stores/personaStore';
import { getExecutionLog } from '@/api/executions';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';
import { formatDuration } from '@/lib/utils/formatters';

// ── Helpers ──────────────────────────────────────────────────────────────

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

function formatCost(v: number): string {
  if (v < 0.001) return '<$0.001';
  return `$${v.toFixed(4)}`;
}

const SPEED_OPTIONS = [1, 2, 4, 8] as const;

// ── Sub-Components ───────────────────────────────────────────────────────

/** Timeline scrub bar with tool step markers. */
function TimelineScrubber({
  currentMs,
  totalMs,
  toolSteps,
  activeStepIndex,
  forkPoint,
  onScrub,
  onSetForkPoint,
}: {
  currentMs: number;
  totalMs: number;
  toolSteps: ToolCallStep[];
  activeStepIndex: number | null;
  forkPoint: number | null;
  onScrub: (ms: number) => void;
  onSetForkPoint: (idx: number | null) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!trackRef.current || totalMs <= 0) return;
      const rect = trackRef.current.getBoundingClientRect();
      const scrub = (clientX: number) => {
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        onScrub(pct * totalMs);
      };
      scrub(e.clientX);
      const onMove = (ev: PointerEvent) => scrub(ev.clientX);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [totalMs, onScrub],
  );

  const pct = totalMs > 0 ? (currentMs / totalMs) * 100 : 0;

  return (
    <div className="space-y-1">
      {/* Track */}
      <div
        ref={trackRef}
        onPointerDown={handlePointerDown}
        className="relative h-3 bg-secondary/50 rounded-full cursor-pointer border border-primary/10 overflow-hidden select-none"
      >
        {/* Progress fill */}
        <div
          className="absolute top-0 left-0 h-full bg-gradient-to-r from-blue-500/60 to-violet-500/60 rounded-full transition-[width] duration-75"
          style={{ width: `${pct}%` }}
        />

        {/* Tool step markers */}
        {toolSteps.map((s) => {
          const x = totalMs > 0 ? (s.started_at_ms / totalMs) * 100 : 0;
          const isFork = forkPoint === s.step_index;
          return (
            <div
              key={s.step_index}
              className={`absolute top-0 h-full w-[3px] transition-colors cursor-pointer ${
                isFork
                  ? 'bg-amber-400/90 z-10'
                  : activeStepIndex === s.step_index
                    ? 'bg-blue-400/80'
                    : 'bg-primary/25'
              }`}
              style={{ left: `${x}%` }}
              title={`Step ${s.step_index + 1}: ${s.tool_name}`}
              onClick={(e) => {
                e.stopPropagation();
                onSetForkPoint(isFork ? null : s.step_index);
              }}
            />
          );
        })}

        {/* Playhead */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border-2 border-blue-500 shadow-md shadow-blue-500/30 transition-[left] duration-75 z-20"
          style={{ left: `calc(${pct}% - 7px)` }}
        />
      </div>

      {/* Time labels */}
      <div className="flex justify-between text-[10px] font-mono text-muted-foreground/50 tabular-nums">
        <span>{formatMs(currentMs)}</span>
        <span>{formatMs(totalMs)}</span>
      </div>
    </div>
  );
}

/** Replay terminal panel — shows log lines up to current scrub position. */
function ReplayTerminalPanel({
  visibleLines,
  totalLines,
}: {
  visibleLines: Array<{ index: number; text: string; timestamp_ms: number }>;
  totalLines: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines.length]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
        <Terminal className="w-3.5 h-3.5 text-muted-foreground/60" />
        <span className="text-xs font-medium text-muted-foreground/70">Output</span>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/40">
          {visibleLines.length}/{totalLines} lines
        </span>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2 font-mono text-xs leading-relaxed"
      >
        {visibleLines.map((line) => {
          const style = classifyLine(line.text);
          const cls = TERMINAL_STYLE_MAP[style];
          return (
            <div key={line.index} className={cls || 'text-foreground/90'}>
              {line.text || '\u00A0'}
            </div>
          );
        })}
        {visibleLines.length === 0 && (
          <div className="text-muted-foreground/40 italic">Scrub forward to see output...</div>
        )}
      </div>
    </div>
  );
}

/** Tool inspector panel — tool cards with active/completed/pending states. */
function ReplayToolPanel({
  toolSteps,
  completedSteps,
  activeStep,
  forkPoint,
  onFork,
}: {
  toolSteps: ToolCallStep[];
  completedSteps: ToolCallStep[];
  activeStep: ToolCallStep | null;
  forkPoint: number | null;
  onFork: (idx: number | null) => void;
}) {
  const completedSet = useMemo(() => new Set(completedSteps.map((s) => s.step_index)), [completedSteps]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
        <Wrench className="w-3.5 h-3.5 text-muted-foreground/60" />
        <span className="text-xs font-medium text-muted-foreground/70">Tool Steps</span>
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground/40">
          {completedSteps.length}/{toolSteps.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
        {toolSteps.map((step) => {
          const isCompleted = completedSet.has(step.step_index);
          const isActive = activeStep?.step_index === step.step_index;
          const isFork = forkPoint === step.step_index;
          const isPending = !isCompleted && !isActive;

          return (
            <div
              key={step.step_index}
              className={`relative rounded-lg border px-3 py-2 transition-all ${
                isFork
                  ? 'border-amber-400/50 bg-amber-500/10 ring-1 ring-amber-400/30'
                  : isActive
                    ? 'border-blue-400/40 bg-blue-500/10 ring-1 ring-blue-400/20'
                    : isCompleted
                      ? 'border-emerald-500/20 bg-emerald-500/5'
                      : 'border-primary/10 bg-secondary/20 opacity-40'
              }`}
            >
              <div className="flex items-center gap-2">
                {/* Step number */}
                <span className={`text-[10px] font-mono tabular-nums ${
                  isActive ? 'text-blue-400' : isCompleted ? 'text-emerald-400' : 'text-muted-foreground/40'
                }`}>
                  {step.step_index + 1}
                </span>

                {/* Status indicator */}
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  isActive
                    ? 'bg-blue-400 animate-pulse'
                    : isCompleted
                      ? 'bg-emerald-400'
                      : 'bg-muted-foreground/20'
                }`} />

                {/* Tool name */}
                <span className={`text-xs font-mono truncate ${
                  isPending ? 'text-muted-foreground/40' : 'text-foreground/80'
                }`}>
                  {step.tool_name}
                </span>

                {/* Duration */}
                {step.duration_ms != null && isCompleted && (
                  <span className="ml-auto text-[10px] font-mono text-muted-foreground/40 tabular-nums">
                    {formatDuration(step.duration_ms)}
                  </span>
                )}

                {/* Fork marker */}
                {isFork && (
                  <GitFork className="w-3 h-3 text-amber-400 shrink-0" />
                )}
              </div>

              {/* Fork toggle on click */}
              {(isCompleted || isActive) && (
                <button
                  onClick={() => onFork(isFork ? null : step.step_index)}
                  className="absolute inset-0 rounded-lg"
                  title={isFork ? 'Clear fork point' : `Fork after step ${step.step_index + 1}`}
                />
              )}
            </div>
          );
        })}
        {toolSteps.length === 0 && (
          <div className="text-center py-6 text-xs text-muted-foreground/40">No tool calls recorded</div>
        )}
      </div>
    </div>
  );
}

/** Cost accumulator panel. */
function ReplayCostPanel({
  accumulatedCost,
  totalCost,
  currentMs,
  totalMs,
  completedSteps,
  totalSteps,
}: {
  accumulatedCost: number;
  totalCost: number;
  currentMs: number;
  totalMs: number;
  completedSteps: number;
  totalSteps: number;
}) {
  const costPct = totalCost > 0 ? (accumulatedCost / totalCost) * 100 : 0;
  const timePct = totalMs > 0 ? (currentMs / totalMs) * 100 : 0;

  return (
    <div className="flex items-center gap-4 px-4 py-2.5 border-t border-primary/10 bg-secondary/20">
      {/* Cost */}
      <div className="flex items-center gap-1.5">
        <DollarSign className="w-3 h-3 text-emerald-400/60" />
        <span className="text-xs font-mono tabular-nums text-emerald-400">
          {formatCost(accumulatedCost)}
        </span>
        <span className="text-[10px] text-muted-foreground/40">
          / {formatCost(totalCost)}
        </span>
      </div>

      {/* Cost bar */}
      <div className="flex-1 h-1.5 bg-secondary/50 rounded-full overflow-hidden max-w-[120px]">
        <div
          className="h-full bg-emerald-500/50 rounded-full transition-[width] duration-150"
          style={{ width: `${costPct}%` }}
        />
      </div>

      {/* Time */}
      <div className="flex items-center gap-1.5">
        <Clock className="w-3 h-3 text-blue-400/60" />
        <span className="text-xs font-mono tabular-nums text-blue-400">
          {formatMs(currentMs)}
        </span>
        <span className="text-[10px] text-muted-foreground/40">
          ({timePct.toFixed(0)}%)
        </span>
      </div>

      {/* Steps */}
      <div className="flex items-center gap-1.5">
        <Hash className="w-3 h-3 text-muted-foreground/50" />
        <span className="text-xs font-mono tabular-nums text-muted-foreground/60">
          {completedSteps}/{totalSteps} steps
        </span>
      </div>
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────

interface ReplaySandboxProps {
  execution: DbPersonaExecution;
}

export function ReplaySandbox({ execution }: ReplaySandboxProps) {
  const setRerunInputData = usePersonaStore((s) => s.setRerunInputData);

  // Fetch log content
  const [logContent, setLogContent] = useState<string | null>(null);
  const [logLoading, setLogLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLogLoading(true);
    getExecutionLog(execution.id, execution.persona_id)
      .then((content) => {
        if (!cancelled) setLogContent(content);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLogLoading(false);
      });
    return () => { cancelled = true; };
  }, [execution.id, execution.persona_id]);

  const [state, actions] = useReplayTimeline(
    execution.tool_steps ?? null,
    logContent,
    execution.duration_ms ?? null,
    execution.cost_usd,
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          actions.togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) actions.stepBackward();
          else actions.scrubTo(state.currentMs - 500);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) actions.stepForward();
          else actions.scrubTo(state.currentMs + 500);
          break;
        case 'Home':
          actions.jumpToStart();
          break;
        case 'End':
          actions.jumpToEnd();
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [actions, state.currentMs]);

  const handleFork = useCallback(() => {
    if (state.forkPoint == null) return;

    // Build context from completed tool steps up to fork point
    const stepsUpToFork = state.toolSteps.filter((s) => s.step_index <= state.forkPoint!);
    const context = stepsUpToFork.map((s) => `[Tool: ${s.tool_name}]\nInput: ${s.input_preview}\nOutput: ${s.output_preview}`).join('\n\n');

    const forkInput = JSON.stringify({
      ...JSON.parse(execution.input_data || '{}'),
      __fork_context: `Continuing from step ${state.forkPoint! + 1}. Previous tool results:\n${context}`,
      __fork_source_execution: execution.id,
      __fork_step_index: state.forkPoint,
    }, null, 2);

    setRerunInputData(forkInput);
  }, [state.forkPoint, state.toolSteps, execution, setRerunInputData]);

  if (logLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground/60">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading execution data...</span>
      </div>
    );
  }

  const activeStepIndex = state.activeStep?.step_index ?? null;

  return (
    <div className="flex flex-col rounded-xl border border-primary/10 bg-background/50 overflow-hidden" style={{ height: 520 }}>
      {/* Transport controls */}
      <div className="px-4 py-3 border-b border-primary/10 space-y-2.5">
        {/* Scrubber */}
        <TimelineScrubber
          currentMs={state.currentMs}
          totalMs={state.totalMs}
          toolSteps={state.toolSteps}
          activeStepIndex={activeStepIndex}
          forkPoint={state.forkPoint}
          onScrub={actions.scrubTo}
          onSetForkPoint={actions.setForkPoint}
        />

        {/* Playback buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={actions.jumpToStart}
            className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
            title="Jump to start (Home)"
          >
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={actions.stepBackward}
            className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
            title="Previous step (Shift+Left)"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={actions.togglePlay}
            className={`p-2 rounded-xl border transition-all ${
              state.isPlaying
                ? 'bg-blue-500/15 border-blue-500/25 text-blue-400'
                : 'bg-primary/10 border-primary/20 text-foreground/80 hover:bg-primary/15'
            }`}
            title="Play/Pause (Space)"
          >
            {state.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            onClick={actions.stepForward}
            className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
            title="Next step (Shift+Right)"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={actions.jumpToEnd}
            className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
            title="Jump to end (End)"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>

          {/* Speed selector */}
          <div className="ml-3 flex items-center gap-0.5 bg-secondary/30 rounded-lg border border-primary/10 p-0.5">
            {SPEED_OPTIONS.map((s) => (
              <button
                key={s}
                onClick={() => actions.setSpeed(s)}
                className={`px-2 py-0.5 text-[10px] font-mono rounded-md transition-colors ${
                  state.speed === s
                    ? 'bg-primary/15 text-foreground/90 border border-primary/20'
                    : 'text-muted-foreground/50 hover:text-muted-foreground/80 border border-transparent'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Fork button */}
          <AnimatePresence>
            {state.forkPoint != null && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, x: -8 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.9, x: -8 }}
                className="ml-auto flex items-center gap-2"
              >
                <button
                  onClick={() => actions.setForkPoint(null)}
                  className="p-1 rounded-md hover:bg-secondary/50 text-muted-foreground/40 hover:text-muted-foreground"
                  title="Clear fork point"
                >
                  <X className="w-3 h-3" />
                </button>
                <button
                  onClick={handleFork}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/25 hover:bg-amber-500/25 transition-colors"
                >
                  <GitFork className="w-3 h-3" />
                  Fork after step {state.forkPoint + 1}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Synchronized panels */}
      <div className="flex-1 flex overflow-hidden">
        {/* Terminal panel (left, 60%) */}
        <div className="flex-[3] min-w-0 border-r border-primary/10">
          <ReplayTerminalPanel
            visibleLines={state.visibleLines}
            totalLines={state.allLines.length}
          />
        </div>

        {/* Tool inspector panel (right, 40%) */}
        <div className="flex-[2] min-w-0">
          <ReplayToolPanel
            toolSteps={state.toolSteps}
            completedSteps={state.completedSteps}
            activeStep={state.activeStep}
            forkPoint={state.forkPoint}
            onFork={actions.setForkPoint}
          />
        </div>
      </div>

      {/* Cost accumulator footer */}
      <ReplayCostPanel
        accumulatedCost={state.accumulatedCost}
        totalCost={execution.cost_usd}
        currentMs={state.currentMs}
        totalMs={state.totalMs}
        completedSteps={state.completedSteps.length}
        totalSteps={state.toolSteps.length}
      />
    </div>
  );
}
