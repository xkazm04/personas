import { useState, useCallback, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import type { PersonaExecution } from '@/lib/types/types';
import { useReplayTimeline } from '@/hooks/execution/useReplayTimeline';
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from '@/stores/toastStore';
import { getExecutionLog } from '@/api/agents/executions';

import { createLogger } from '@/lib/log';
import { TimelineScrubber } from './TimelineScrubber';

const logger = createLogger("replay-sandbox");
import { ReplayTerminalPanel } from './ReplayTerminalPanel';
import { ReplayToolPanel } from './ReplayToolPanel';
import { ReplayCostPanel } from './ReplayCostPanel';
import { ReplayTransportControls } from './ReplayTransportControls';

// -- Main Component -------------------------------------------------------

interface ReplaySandboxProps {
  execution: PersonaExecution;
}

export function ReplaySandbox({ execution }: ReplaySandboxProps) {
  const setRerunInputData = useSystemStore((s) => s.setRerunInputData);
  const addToast = useToastStore((s) => s.addToast);

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
      .catch((err) => { logger.warn('Failed to load execution log', { error: err }); })
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

    const stepsUpToFork = state.toolSteps.filter((s) => s.step_index <= state.forkPoint!);
    const context = stepsUpToFork.map((s) => `[Tool: ${s.tool_name}]\nInput: ${s.input_preview}\nOutput: ${s.output_preview}`).join('\n\n');

    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = JSON.parse(execution.input_data || '{}');
    } catch {
      addToast('Original input data could not be parsed — using empty input', 'error');
    }

    const forkInput = JSON.stringify({
      ...parsedInput,
      __fork_context: `Continuing from step ${state.forkPoint! + 1}. Previous tool results:\n${context}`,
      __fork_source_execution: execution.id,
      __fork_step_index: state.forkPoint,
    }, null, 2);

    setRerunInputData(forkInput);
  }, [state.forkPoint, state.toolSteps, execution, setRerunInputData, addToast]);

  if (logLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground/60">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="typo-body">Loading execution data...</span>
      </div>
    );
  }

  const activeStepIndex = state.activeStep?.step_index ?? null;

  return (
    <div className="flex flex-col rounded-xl border border-primary/10 bg-background/50 overflow-hidden" style={{ height: 520 }}>
      {/* Transport controls */}
      <div className="px-4 py-3 border-b border-primary/10 space-y-2.5">
        <TimelineScrubber
          currentMs={state.currentMs}
          totalMs={state.totalMs}
          toolSteps={state.toolSteps}
          activeStepIndex={activeStepIndex}
          forkPoint={state.forkPoint}
          onScrub={actions.scrubTo}
          onSetForkPoint={actions.setForkPoint}
        />
        <ReplayTransportControls
          isPlaying={state.isPlaying}
          speed={state.speed}
          forkPoint={state.forkPoint}
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

      {/* Synchronized panels */}
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-[3] min-w-0 border-r border-primary/10">
          <ReplayTerminalPanel
            visibleLines={state.visibleLines}
            totalLines={state.allLines.length}
          />
        </div>
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
