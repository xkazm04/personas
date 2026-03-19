import { useState, useCallback, useEffect, useMemo } from 'react';
import {
  Film,
  Terminal,
  Wrench,
  Activity,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { PersonaExecution } from '@/lib/types/types';
import { useTheaterState } from '@/hooks/execution/useTheaterState';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';

import { TimelineScrubber } from './TimelineScrubber';
import { ReplayTerminalPanel } from './ReplayTerminalPanel';
import { ReplayCostPanel } from './ReplayCostPanel';
import { ReplayTransportControls } from './ReplayTransportControls';
import { PipelineStageIndicator } from '../components/replay/PipelineStageIndicator';
import { ExpandableToolStep } from '../components/replay/ExpandableToolStep';
import { ReplayTracePanel } from '../components/replay/ReplayTracePanel';
import { HealingOverlay } from '../components/replay/HealingOverlay';
import { ChainCascadeTimeline } from '../components/replay/ChainCascadeTimeline';

interface ReplayTheaterProps {
  execution: PersonaExecution;
}

type TheaterPanel = 'terminal' | 'tools' | 'trace';

/**
 * Cinematic execution replay theater.
 *
 * Provides a multi-panel, time-synchronized view of an execution:
 * - Pipeline stage progress indicator (7-stage)
 * - Timeline scrubber with tool-step markers
 * - Terminal output, expandable tool steps, and trace spans panels
 * - Healing diagnosis overlay for failed executions
 * - Chain cascade visualization for multi-persona chains
 * - Fork-at-any-point for what-if branching
 */
export function ReplayTheater({ execution }: ReplayTheaterProps) {
  const setRerunInputData = useSystemStore((s) => s.setRerunInputData);
  const addToast = useToastStore((s) => s.addToast);
  const {
    replay,
    actions,
    traceSpans,
    stageBoundaries,
    errorStage,
    chainTraceId,
    isLoading,
  } = useTheaterState(execution);

  const [rightPanel, setRightPanel] = useState<TheaterPanel>('tools');

  const isFailed = execution.status === 'failed' || execution.status === 'incomplete';

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
          else actions.scrubTo(replay.currentMs - 500);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) actions.stepForward();
          else actions.scrubTo(replay.currentMs + 500);
          break;
        case 'Home':
          actions.jumpToStart();
          break;
        case 'End':
          actions.jumpToEnd();
          break;
        case '1':
          setRightPanel('terminal');
          break;
        case '2':
          setRightPanel('tools');
          break;
        case '3':
          if (traceSpans.length > 0) setRightPanel('trace');
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [actions, replay.currentMs, traceSpans.length]);

  // Fork handler
  const handleFork = useCallback(() => {
    if (replay.forkPoint == null) return;

    const stepsUpToFork = replay.toolSteps.filter((s) => s.step_index <= replay.forkPoint!);
    const context = stepsUpToFork
      .map((s) => `[Tool: ${s.tool_name}]\nInput: ${s.input_preview}\nOutput: ${s.output_preview}`)
      .join('\n\n');

    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = JSON.parse(execution.input_data || '{}');
    } catch {
      addToast('Original input data could not be parsed — using empty input', 'error');
    }

    const forkInput = JSON.stringify(
      {
        ...parsedInput,
        __fork_context: `Continuing from step ${replay.forkPoint! + 1}. Previous tool results:\n${context}`,
        __fork_source_execution: execution.id,
        __fork_step_index: replay.forkPoint,
      },
      null,
      2,
    );

    setRerunInputData(forkInput);
  }, [replay.forkPoint, replay.toolSteps, execution, setRerunInputData, addToast]);

  // Tool step state lookup
  const completedSet = useMemo(
    () => new Set(replay.completedSteps.map((s) => s.step_index)),
    [replay.completedSteps],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground/60">
        <LoadingSpinner size="lg" className="mr-2" />
        <span className="typo-body">Loading execution theater...</span>
      </div>
    );
  }

  const activeStepIndex = replay.activeStep?.step_index ?? null;

  return (
    <div className="flex flex-col rounded-xl border border-primary/15 bg-background/60 overflow-hidden backdrop-blur-sm">
      {/* === HEADER: Pipeline Stage Indicator === */}
      <div className="px-4 py-2.5 border-b border-primary/10 bg-secondary/20">
        <div className="flex items-center gap-2 mb-2">
          <Film className="w-4 h-4 text-violet-400" />
          <span className="typo-heading text-foreground/80">Execution Theater</span>
          {execution.model_used && (
            <span className="ml-auto text-[10px] font-mono text-muted-foreground/40">
              {execution.model_used}
            </span>
          )}
        </div>
        <PipelineStageIndicator
          currentMs={replay.currentMs}
          totalMs={replay.totalMs}
          stageBoundaries={stageBoundaries}
          isFailed={isFailed}
          errorStage={errorStage}
        />
      </div>

      {/* === TRANSPORT: Scrubber + Controls === */}
      <div className="px-4 py-3 border-b border-primary/10 space-y-2.5">
        <TimelineScrubber
          currentMs={replay.currentMs}
          totalMs={replay.totalMs}
          toolSteps={replay.toolSteps}
          activeStepIndex={activeStepIndex}
          forkPoint={replay.forkPoint}
          onScrub={actions.scrubTo}
          onSetForkPoint={actions.setForkPoint}
        />
        <ReplayTransportControls
          isPlaying={replay.isPlaying}
          speed={replay.speed}
          forkPoint={replay.forkPoint}
          onTogglePlay={actions.togglePlay}
          onStepBackward={actions.stepBackward}
          onStepForward={actions.stepForward}
          onJumpToStart={actions.jumpToStart}
          onJumpToEnd={actions.jumpToEnd}
          onSetSpeed={actions.setSpeed}
          onClearFork={() => actions.setForkPoint(null)}
          onFork={handleFork}
        />
      </div>

      {/* === MAIN CONTENT: Synchronized Panels === */}
      <div className="flex-1 flex overflow-hidden" style={{ height: 420 }}>
        {/* Left: Terminal Output */}
        <div className="flex-[3] min-w-0 border-r border-primary/10">
          <ReplayTerminalPanel
            visibleLines={replay.visibleLines}
            totalLines={replay.allLines.length}
          />
        </div>

        {/* Right: Tabbed panel */}
        <div className="flex-[2] min-w-0 flex flex-col">
          {/* Panel tab switcher */}
          <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-primary/10 bg-secondary/10">
            <PanelTab
              active={rightPanel === 'tools'}
              icon={<Wrench className="w-3 h-3" />}
              label="Tools"
              shortcut="2"
              onClick={() => setRightPanel('tools')}
            />
            <PanelTab
              active={rightPanel === 'trace'}
              icon={<Activity className="w-3 h-3" />}
              label="Trace"
              shortcut="3"
              onClick={() => setRightPanel('trace')}
              disabled={traceSpans.length === 0}
            />
            <PanelTab
              active={rightPanel === 'terminal'}
              icon={<Terminal className="w-3 h-3" />}
              label="Output"
              shortcut="1"
              onClick={() => setRightPanel('terminal')}
            />
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-hidden">
            {rightPanel === 'tools' && (
              <div className="h-full overflow-y-auto px-2 py-2 space-y-1.5">
                {replay.toolSteps.length > 0 ? (
                  replay.toolSteps.map((step) => {
                    const isCompleted = completedSet.has(step.step_index);
                    const isActive = activeStepIndex === step.step_index;
                    const state = isActive ? 'active' as const : isCompleted ? 'completed' as const : 'pending' as const;

                    return (
                      <ExpandableToolStep
                        key={step.step_index}
                        step={step}
                        state={state}
                        isFork={replay.forkPoint === step.step_index}
                        onFork={actions.setForkPoint}
                      />
                    );
                  })
                ) : (
                  <div className="flex items-center justify-center h-full typo-body text-muted-foreground/50 italic">
                    No tool calls recorded
                  </div>
                )}
              </div>
            )}

            {rightPanel === 'trace' && (
              <ReplayTracePanel
                spans={traceSpans}
                currentMs={replay.currentMs}
                totalMs={replay.totalMs}
              />
            )}

            {rightPanel === 'terminal' && (
              <ReplayTerminalPanel
                visibleLines={replay.visibleLines}
                totalLines={replay.allLines.length}
              />
            )}
          </div>
        </div>
      </div>

      {/* === OVERLAYS: Healing + Chain Cascade === */}
      {(isFailed || chainTraceId) && (
        <div className="border-t border-primary/10 p-3 space-y-3 bg-secondary/10">
          {isFailed && (
            <HealingOverlay
              execution={execution}
              currentMs={replay.currentMs}
              totalMs={replay.totalMs}
            />
          )}

          {chainTraceId && (
            <ChainCascadeTimeline
              chainTraceId={chainTraceId}
              callerPersonaId={execution.persona_id}
              currentExecutionId={execution.id}
              currentMs={replay.currentMs}
              totalMs={replay.totalMs}
            />
          )}
        </div>
      )}

      {/* === FOOTER: Cost Accumulator === */}
      <ReplayCostPanel
        accumulatedCost={replay.accumulatedCost}
        totalCost={execution.cost_usd}
        currentMs={replay.currentMs}
        totalMs={replay.totalMs}
        completedSteps={replay.completedSteps.length}
        totalSteps={replay.toolSteps.length}
      />
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
  disabled,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  shortcut: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg typo-body transition-all${
        active
          ? 'bg-primary/15 text-foreground/90 border border-primary/20'
          : disabled
            ? 'text-muted-foreground/25 cursor-not-allowed border border-transparent'
            : 'text-muted-foreground/50 hover:text-muted-foreground/80 border border-transparent hover:border-primary/10'
      }`}
      title={`${label} (${shortcut})`}
    >
      {icon}
      <span className="hidden lg:inline">{label}</span>
    </button>
  );
}
