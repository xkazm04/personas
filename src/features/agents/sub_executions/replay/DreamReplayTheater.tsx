import { useState, useEffect, useMemo } from 'react';
import {
  Moon,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  ChevronsLeft,
  ChevronsRight,
  AlertTriangle,
  Activity,
  Brain,
  Key,
  Terminal,
  Wrench,
  MessageSquare,
  Link2,
  Eye,
  Stethoscope,
  Cpu,
  Coins,
  Layers,
  Zap,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import Button from '@/features/shared/components/buttons/Button';
import type { PersonaExecution } from '@/lib/types/types';
import type { DreamFrame } from '@/lib/bindings/DreamFrame';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import type { SpanType } from '@/lib/bindings/SpanType';
import { useDreamReplay } from '@/hooks/execution/useDreamReplay';
import { formatDuration } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

interface DreamReplayTheaterProps {
  execution: PersonaExecution;
}

/** Icon + color mapping for each span type. */
const SPAN_CONFIG: Record<SpanType, { icon: typeof Activity; label: string; color: string }> = {
  execution:             { icon: Cpu,           label: 'Execution',       color: 'text-violet-400' },
  prompt_assembly:       { icon: Brain,         label: 'Prompt Assembly', color: 'text-purple-400' },
  credential_resolution: { icon: Key,           label: 'Credential',     color: 'text-amber-400' },
  cli_spawn:             { icon: Terminal,       label: 'CLI Spawn',      color: 'text-emerald-400' },
  tool_call:             { icon: Wrench,         label: 'Tool Call',      color: 'text-cyan-400' },
  protocol_dispatch:     { icon: MessageSquare,  label: 'Protocol',       color: 'text-blue-400' },
  chain_evaluation:      { icon: Link2,          label: 'Chain Eval',     color: 'text-orange-400' },
  stream_processing:     { icon: Activity,       label: 'Stream',         color: 'text-teal-400' },
  outcome_assessment:    { icon: Eye,            label: 'Outcome',        color: 'text-indigo-400' },
  healing_analysis:      { icon: Stethoscope,    label: 'Healing',        color: 'text-rose-400' },
  pipeline_stage:        { icon: Layers,         label: 'Pipeline Stage', color: 'text-indigo-400' },
};

/**
 * Dream Replay Theater -- Deterministic execution replay from trace spans.
 *
 * VCR-style debugger that reconstructs execution state frame-by-frame
 * from stored trace data, consuming zero LLM tokens. Provides:
 * - Time-travel scrubber across all span boundaries
 * - Frame-by-frame stepping forward/backward
 * - Active/completed span state at each frame
 * - Span tree depth visualization
 * - Cumulative cost/token tracking
 * - Error frame navigation
 */
export function DreamReplayTheater({ execution }: DreamReplayTheaterProps) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const [state, actions] = useDreamReplay(execution);
  const [rightPanel, setRightPanel] = useState<'state' | 'tree' | 'history'>('state');

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
          if (e.shiftKey) actions.jumpToStart();
          else actions.stepBackward();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) actions.jumpToEnd();
          else actions.stepForward();
          break;
        case 'Home':
          actions.jumpToStart();
          break;
        case 'End':
          actions.jumpToEnd();
          break;
        case 'e':
          if (e.shiftKey) actions.jumpToPrevError();
          else actions.jumpToNextError();
          break;
        case '1':
          setRightPanel('state');
          break;
        case '2':
          setRightPanel('tree');
          break;
        case '3':
          setRightPanel('history');
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [actions]);

  // Error frame indices for scrubber markers
  const errorIndices = useMemo(
    () => state.frames.reduce<number[]>((acc, f, i) => {
      if (f.error != null) acc.push(i);
      return acc;
    }, []),
    [state.frames],
  );

  if (state.isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-foreground">
        <LoadingSpinner size="lg" className="mr-2" />
        <span className="typo-body">{e.loading_dream_replay}</span>
      </div>
    );
  }

  if (state.error || !state.session) {
    return (
      <div className="flex items-center justify-center h-64 text-foreground">
        <AlertTriangle className="w-4 h-4 mr-2 text-amber-400" />
        <span className="typo-body">{state.error ?? 'No trace data available for dream replay'}</span>
      </div>
    );
  }

  const { currentFrame, totalFrames, currentFrameIndex } = state;

  return (
    <div className="flex flex-col rounded-modal border border-violet-500/20 bg-background/60 overflow-hidden backdrop-blur-sm">
      {/* === HEADER === */}
      <div className="px-4 py-2.5 border-b border-violet-500/15 bg-violet-500/5">
        <div className="flex items-center gap-2">
          <Moon className="w-4 h-4 text-violet-400" />
          <span className="typo-heading text-foreground">{e.dream_replay}</span>
          <span className="text-[10px] font-mono text-violet-400/60 bg-violet-500/10 px-1.5 py-0.5 rounded">
            {e.zero_tokens}
          </span>
          {state.session.isIncomplete && (
            <span className="text-[10px] font-mono text-amber-400/60 bg-amber-500/10 px-1.5 py-0.5 rounded">
              {e.incomplete_trace}
            </span>
          )}
          <span className="ml-auto text-[10px] font-mono text-foreground">
            {e.spans_frames.replace('{spans}', String(state.session.totalSpanCount)).replace('{frames}', String(totalFrames))}
          </span>
        </div>
      </div>

      {/* === FRAME SCRUBBER === */}
      <div className="px-4 py-3 border-b border-violet-500/10 space-y-2">
        {/* Scrubber track */}
        <div className="relative h-6">
          <input
            type="range"
            min={0}
            max={Math.max(totalFrames - 1, 0)}
            value={currentFrameIndex}
            onChange={(e) => actions.jumpToFrame(Number(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-violet-500/15
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-400 [&::-webkit-slider-thumb]:border-2
              [&::-webkit-slider-thumb]:border-violet-300/40 [&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(139,92,246,0.3)]"
          />
          {/* Error markers */}
          {errorIndices.map((idx) => (
            <button
              key={idx}
              className="absolute top-0 w-1.5 h-6 -translate-x-1/2 cursor-pointer group"
              style={{ left: `${totalFrames > 1 ? (idx / (totalFrames - 1)) * 100 : 0}%` }}
              onClick={() => actions.jumpToFrame(idx)}
              title={`Error at frame ${idx}`}
            >
              <div className="w-1 h-3 mx-auto rounded-full bg-red-400/60 group-hover:bg-red-400 transition-colors" />
            </button>
          ))}
        </div>

        {/* Transport controls */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={actions.jumpToStart} title={e.jump_to_start}>
            <ChevronsLeft className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={actions.stepBackward} title={e.previous_step}>
            <ChevronLeft className="w-3.5 h-3.5" />
          </Button>
          <Button variant="accent" accentColor="violet" size="icon-sm" onClick={actions.togglePlay} title={e.play_pause}>
            {state.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={actions.stepForward} title={e.next_step}>
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={actions.jumpToEnd} title={e.jump_to_end}>
            <ChevronsRight className="w-3.5 h-3.5" />
          </Button>

          {/* Speed selector */}
          <div className="ml-2 flex items-center gap-0.5">
            {[1, 2, 4, 8].map((s) => (
              <button
                key={s}
                onClick={() => actions.setSpeed(s)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
                  state.speed === s
                    ? 'bg-violet-500/20 text-violet-300'
                    : 'text-foreground hover:text-muted-foreground/70'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Error navigation */}
          {errorIndices.length > 0 && (
            <div className="ml-2 flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" onClick={actions.jumpToPrevError} title="Previous error (Shift+E)" className="text-red-400/50 hover:text-red-400 hover:bg-red-500/10">
                <SkipBack className="w-3 h-3" />
              </Button>
              <span className="text-[10px] font-mono text-red-400/50">{errorIndices.length} err</span>
              <Button variant="ghost" size="icon-sm" onClick={actions.jumpToNextError} title="Next error (E)" className="text-red-400/50 hover:text-red-400 hover:bg-red-500/10">
                <SkipForward className="w-3 h-3" />
              </Button>
            </div>
          )}

          {/* Frame counter + time */}
          <div className="ml-auto flex items-center gap-3 text-[10px] font-mono text-foreground tabular-nums">
            <span>Frame {currentFrameIndex + 1}/{totalFrames}</span>
            <span>{formatDuration(state.currentMs)} / {formatDuration(state.totalMs)}</span>
          </div>
        </div>
      </div>

      {/* === CURRENT FRAME DESCRIPTION === */}
      {currentFrame && (
        <div className="px-4 py-2 border-b border-violet-500/10 bg-secondary/10">
          <FrameDescription frame={currentFrame} />
        </div>
      )}

      {/* === MAIN CONTENT === */}
      <div className="flex-1 flex overflow-hidden" style={{ height: 380 }}>
        {/* Left: Span Tree Visualization */}
        <div className="flex-[3] min-w-0 border-r border-violet-500/10 overflow-y-auto">
          <SpanTreePanel
            frames={state.frames}
            currentFrameIndex={currentFrameIndex}
            onJumpToFrame={actions.jumpToFrame}
          />
        </div>

        {/* Right: State/History panels */}
        <div className="flex-[2] min-w-0 flex flex-col">
          {/* Panel tabs */}
          <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-violet-500/10 bg-secondary/10">
            <PanelTab active={rightPanel === 'state'} label="State" shortcut="1" onClick={() => setRightPanel('state')} icon={<Layers className="w-3 h-3" />} />
            <PanelTab active={rightPanel === 'tree'} label="Active" shortcut="2" onClick={() => setRightPanel('tree')} icon={<Activity className="w-3 h-3" />} />
            <PanelTab active={rightPanel === 'history'} label="Cost" shortcut="3" onClick={() => setRightPanel('history')} icon={<Coins className="w-3 h-3" />} />
          </div>

          <div className="flex-1 overflow-y-auto">
            {rightPanel === 'state' && currentFrame && (
              <FrameStatePanel frame={currentFrame} activeSpans={state.activeSpans} completedSpans={state.completedSpans} />
            )}
            {rightPanel === 'tree' && (
              <ActiveSpansPanel activeSpans={state.activeSpans} currentMs={state.currentMs} />
            )}
            {rightPanel === 'history' && currentFrame && (
              <CostPanel frame={currentFrame} session={state.session} />
            )}
          </div>
        </div>
      </div>

      {/* === FOOTER: Depth + Cost bar === */}
      <div className="px-4 py-2 border-t border-violet-500/10 bg-secondary/10 flex items-center gap-4 text-[10px] font-mono text-foreground">
        <span className="flex items-center gap-1">
          <Layers className="w-3 h-3" />
          {e.depth_label} {state.currentDepth}
        </span>
        <span className="flex items-center gap-1">
          <Coins className="w-3 h-3" />
          ${currentFrame?.cumulativeCostUsd.toFixed(4) ?? '0.0000'}
        </span>
        <span>{(currentFrame?.cumulativeInputTokens ?? 0).toLocaleString()} in</span>
        <span>{(currentFrame?.cumulativeOutputTokens ?? 0).toLocaleString()} out</span>
        <span className="ml-auto flex items-center gap-1">
          <Zap className="w-3 h-3 text-violet-400" />
          <span className="text-violet-400/60">{e.deterministic_replay}</span>
        </span>
      </div>
    </div>
  );
}

/** Renders the current frame description with event-type styling. */
function FrameDescription({ frame }: { frame: DreamFrame }) {
  const config = SPAN_CONFIG[frame.triggerSpanType];
  const Icon = config?.icon ?? Activity;
  const color = config?.color ?? 'text-foreground';

  const eventBadge = frame.eventType === 'span_start'
    ? { text: 'START', cls: 'bg-blue-500/15 text-blue-400' }
    : frame.eventType === 'span_error'
      ? { text: 'ERROR', cls: 'bg-red-500/15 text-red-400' }
      : { text: 'END', cls: 'bg-emerald-500/15 text-emerald-400' };

  return (
    <div className="flex items-center gap-2">
      <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase ${eventBadge.cls}`}>
        {eventBadge.text}
      </span>
      <span className="typo-body text-foreground truncate">{frame.description}</span>
      <span className="ml-auto text-[10px] font-mono text-foreground shrink-0">
        {formatDuration(frame.timestampMs)}
      </span>
    </div>
  );
}

/** Span tree visualization showing depth-indented frames. */
function SpanTreePanel({
  frames,
  currentFrameIndex,
  onJumpToFrame,
}: {
  frames: DreamFrame[];
  currentFrameIndex: number;
  onJumpToFrame: (index: number) => void;
}) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  // Show a window of frames around the current one
  const windowSize = 50;
  const start = Math.max(0, currentFrameIndex - Math.floor(windowSize / 2));
  const end = Math.min(frames.length, start + windowSize);
  const visibleFrames = frames.slice(start, end);

  return (
    <div className="px-2 py-2">
      <div className="text-[10px] font-mono text-violet-400/60 uppercase tracking-wider px-1 mb-2">
        {e.span_boundaries}
      </div>
      <div className="space-y-0.5">
        {visibleFrames.map((frame) => {
          const isCurrent = frame.index === currentFrameIndex;
          const config = SPAN_CONFIG[frame.triggerSpanType];
          const Icon = config?.icon ?? Activity;
          const color = config?.color ?? 'text-foreground';

          const eventColor = frame.eventType === 'span_start'
            ? 'text-blue-400/70'
            : frame.eventType === 'span_error'
              ? 'text-red-400/70'
              : 'text-emerald-400/70';

          const eventChar = frame.eventType === 'span_start' ? '\u25B6' : frame.eventType === 'span_error' ? '\u2718' : '\u2714';

          return (
            <button
              key={frame.index}
              onClick={() => onJumpToFrame(frame.index)}
              className={`w-full text-left flex items-center gap-1 px-1.5 py-1 rounded-card transition-all text-[11px] font-mono ${
                isCurrent
                  ? 'bg-violet-500/15 border border-violet-500/25 text-foreground/90'
                  : 'hover:bg-secondary/30 text-foreground border border-transparent'
              }`}
            >
              {/* Depth indentation */}
              <span style={{ width: frame.depth * 12 }} className="shrink-0" />
              {/* Event indicator */}
              <span className={`shrink-0 ${eventColor}`}>{eventChar}</span>
              {/* Span icon */}
              <Icon className={`w-3 h-3 shrink-0 ${isCurrent ? color : 'text-foreground'}`} />
              {/* Description */}
              <span className="truncate">{frame.description}</span>
              {/* Timestamp */}
              <span className="ml-auto shrink-0 text-[9px] text-foreground tabular-nums">
                {formatDuration(frame.timestampMs)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Frame state panel showing detailed span info at current frame. */
function FrameStatePanel({
  frame,
  activeSpans,
  completedSpans,
}: {
  frame: DreamFrame;
  activeSpans: TraceSpan[];
  completedSpans: TraceSpan[];
}) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  return (
    <div className="px-3 py-2 space-y-3">
      {/* Active span count */}
      <div>
        <div className="text-[10px] font-mono text-blue-400/60 uppercase tracking-wider mb-1">
          {e.active_count_label.replace('{count}', String(activeSpans.length))}
        </div>
        {activeSpans.length === 0 ? (
          <div className="text-[11px] text-foreground italic">{e.no_active_spans}</div>
        ) : (
          <div className="space-y-1">
            {activeSpans.map((span) => (
              <MiniSpanCard key={span.span_id} span={span} variant="active" />
            ))}
          </div>
        )}
      </div>

      {/* Completed spans (recent) */}
      <div>
        <div className="text-[10px] font-mono text-emerald-400/60 uppercase tracking-wider mb-1">
          {e.completed_count_label.replace('{count}', String(frame.completedSpanIds.length))}
        </div>
        {completedSpans.length === 0 ? (
          <div className="text-[11px] text-foreground italic">{e.none_yet}</div>
        ) : (
          <div className="space-y-1">
            {completedSpans.slice(0, 10).map((span) => (
              <MiniSpanCard key={span.span_id} span={span} variant="completed" />
            ))}
            {completedSpans.length > 10 && (
              <div className="text-[10px] text-foreground italic px-1">
                {e.plus_more.replace('{count}', String(completedSpans.length - 10))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Metadata */}
      {frame.metadata != null && (
        <div>
          <div className="text-[10px] font-mono text-foreground uppercase tracking-wider mb-1">
            {e.metadata_label}
          </div>
          <pre className="text-[10px] font-mono text-foreground bg-secondary/20 rounded-card p-2 overflow-x-auto max-h-32 overflow-y-auto">
            {String(JSON.stringify(frame.metadata, null, 2))}
          </pre>
        </div>
      )}
    </div>
  );
}

/** Active spans panel. */
function ActiveSpansPanel({ activeSpans, currentMs }: { activeSpans: TraceSpan[]; currentMs: number }) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  return (
    <div className="px-3 py-2">
      <div className="text-[10px] font-mono text-blue-400/60 uppercase tracking-wider mb-2">
        {e.active_spans}
      </div>
      {activeSpans.length === 0 ? (
        <div className="text-[11px] text-foreground italic">{e.no_active_spans_frame}</div>
      ) : (
        <div className="space-y-1.5">
          {activeSpans.map((span) => {
            const config = SPAN_CONFIG[span.span_type];
            const Icon = config?.icon ?? Activity;
            const color = config?.color ?? 'text-foreground';
            const elapsed = currentMs - span.start_ms;

            return (
              <div key={span.span_id} className="rounded-card border border-blue-400/20 bg-blue-500/5 px-2.5 py-1.5">
                <div className="flex items-center gap-2">
                  <Icon className={`w-3 h-3 shrink-0 ${color}`} />
                  <span className="typo-code text-foreground truncate">{span.name}</span>
                  <span className="ml-auto text-[10px] font-mono text-blue-400/60 tabular-nums shrink-0">
                    {formatDuration(elapsed)}
                  </span>
                </div>
                {(span.input_tokens != null || span.output_tokens != null) && (
                  <div className="mt-1 flex gap-2 text-[10px] font-mono text-foreground">
                    {span.input_tokens != null && <span>{span.input_tokens.toLocaleString()} in</span>}
                    {span.output_tokens != null && <span>{span.output_tokens.toLocaleString()} out</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Cost accumulation panel. */
function CostPanel({
  frame,
  session,
}: {
  frame: DreamFrame;
  session: { totalCostUsd: number; totalInputTokens: number; totalOutputTokens: number };
}) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const costPct = session.totalCostUsd > 0 ? (frame.cumulativeCostUsd / session.totalCostUsd) * 100 : 0;
  const inputPct = session.totalInputTokens > 0 ? (frame.cumulativeInputTokens / session.totalInputTokens) * 100 : 0;
  const outputPct = session.totalOutputTokens > 0 ? (frame.cumulativeOutputTokens / session.totalOutputTokens) * 100 : 0;

  return (
    <div className="px-3 py-2 space-y-3">
      <div className="text-[10px] font-mono text-foreground uppercase tracking-wider">
        {e.cost_accumulation}
      </div>

      <CostBar label="Cost" value={`$${frame.cumulativeCostUsd.toFixed(4)}`} total={`$${session.totalCostUsd.toFixed(4)}`} pct={costPct} color="violet" />
      <CostBar label="Input" value={frame.cumulativeInputTokens.toLocaleString()} total={session.totalInputTokens.toLocaleString()} pct={inputPct} color="blue" />
      <CostBar label="Output" value={frame.cumulativeOutputTokens.toLocaleString()} total={session.totalOutputTokens.toLocaleString()} pct={outputPct} color="emerald" />

      <div className="mt-4 p-2.5 rounded-card bg-violet-500/5 border border-violet-500/15">
        <div className="text-[10px] font-mono text-violet-400/60 mb-1">{e.dream_replay_cost}</div>
        <div className="typo-heading-lg font-mono text-violet-400">$0.0000</div>
        <div className="text-[10px] text-foreground mt-1">
          {e.dream_replay_zero}
        </div>
      </div>
    </div>
  );
}

function CostBar({ label, value, total, pct, color }: { label: string; value: string; total: string; pct: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] font-mono mb-1">
        <span className="text-foreground">{label}</span>
        <span className="text-foreground">{value} <span className="text-foreground">/ {total}</span></span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary/30 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 bg-${color}-400/60`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
    </div>
  );
}

/** Minimal span card for state panel. */
function MiniSpanCard({ span, variant }: { span: TraceSpan; variant: 'active' | 'completed' }) {
  const config = SPAN_CONFIG[span.span_type];
  const Icon = config?.icon ?? Activity;
  const color = config?.color ?? 'text-foreground';

  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-card text-[11px] font-mono ${
      variant === 'active'
        ? 'bg-blue-500/8 border border-blue-400/20'
        : 'bg-secondary/15 border border-primary/5'
    }`}>
      <Icon className={`w-3 h-3 shrink-0 ${variant === 'active' ? color : 'text-foreground'}`} />
      <span className={`truncate ${variant === 'active' ? 'text-foreground' : 'text-foreground'}`}>
        {span.name}
      </span>
      {variant === 'completed' && span.duration_ms != null && (
        <span className="ml-auto text-[9px] text-foreground shrink-0 tabular-nums">
          {formatDuration(span.duration_ms)}
        </span>
      )}
      {span.error && <AlertTriangle className="w-3 h-3 shrink-0 text-red-400/60" />}
    </div>
  );
}

/** Panel tab button. */
function PanelTab({
  active,
  icon,
  label,
  shortcut,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  shortcut: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-card typo-body transition-all${
        active
          ? 'bg-violet-500/15 text-violet-300 border border-violet-500/20'
          : 'text-foreground hover:text-muted-foreground/80 border border-transparent hover:border-violet-500/10'
      }`}
      title={`${label} (${shortcut})`}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
