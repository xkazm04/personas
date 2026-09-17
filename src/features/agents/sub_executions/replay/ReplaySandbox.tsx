import { useState, useCallback, useEffect, useRef } from 'react';
import type { PersonaExecution } from '@/lib/types/types';
import { useReplayTimeline } from '@/hooks/execution/useReplayTimeline';
import { useSystemStore } from "@/stores/systemStore";
import { useToastStore } from '@/stores/toastStore';
import { getExecutionLogLines } from '@/api/agents/executions';

import { createLogger } from '@/lib/log';
import { silentCatch } from '@/lib/silentCatch';
import { TimelineScrubber } from './TimelineScrubber';
import { ReplayTerminalPanel } from './ReplayTerminalPanel';
import { ReplayToolPanel } from './ReplayToolPanel';
import { ReplayCostPanel } from './ReplayCostPanel';
import { ReplayTransportControls } from './ReplayTransportControls';
import { useTranslation } from '@/i18n/useTranslation';

const logger = createLogger("replay-sandbox");
/** First stdout page — matches `get_execution_log_lines` default page size. */
const LOG_PAGE_SIZE = 500;

// -- Main Component -------------------------------------------------------

interface ReplaySandboxProps {
  execution: PersonaExecution;
}

export function ReplaySandbox({ execution }: ReplaySandboxProps) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const setRerunInputData = useSystemStore((s) => s.setRerunInputData);
  const addToast = useToastStore((s) => s.addToast);

  // First page of stdout (forward from offset 0). The full-file command
  // `get_execution_log` can ship 10 MB; this is the same paged path session
  // recovery already uses. Chrome stays up while the page is in flight.
  const [logLines, setLogLines] = useState<string[] | null>(null);
  const [logLoading, setLogLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLogLines(null);
    setLogLoading(true);
    getExecutionLogLines(execution.id, execution.persona_id, 0, LOG_PAGE_SIZE)
      .then((lines) => {
        if (!cancelled) setLogLines(lines);
      })
      .catch((err) => { silentCatch('ReplaySandbox:getExecutionLogLines')(err); logger.warn('Failed to load execution log', { error: err }); })
      .finally(() => {
        if (!cancelled) setLogLoading(false);
      });
    return () => { cancelled = true; };
  }, [execution.id, execution.persona_id]);

  const [state, actions] = useReplayTimeline(
    execution.tool_steps ?? null,
    logLines,
    execution.duration_ms ?? null,
    execution.cost_usd,
  );

  // Keyboard shortcuts. currentMs is read through a ref so the listener doesn't
  // re-bind on every animation frame during playback.
  const currentMsRef = useRef(state.currentMs);
  currentMsRef.current = state.currentMs;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const target = e.target;
      // Don't hijack typing, and don't fight the scrubber: it is a real slider
      // now and owns its own arrow keys.
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable) ||
        (target instanceof HTMLElement && target.getAttribute('role') === 'slider')
      ) return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          actions.togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) actions.stepBackward();
          else actions.scrubTo(currentMsRef.current - 500);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) actions.stepForward();
          else actions.scrubTo(currentMsRef.current + 500);
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
  }, [actions]);

  const handleFork = useCallback(() => {
    if (state.forkPoint == null) return;

    const stepsUpToFork = state.toolSteps.filter((s) => s.step_index <= state.forkPoint!);
    const context = stepsUpToFork.map((s) => `[Tool: ${s.tool_name}]\nInput: ${s.input_preview}\nOutput: ${s.output_preview}`).join('\n\n');

    let parsedInput: Record<string, unknown> = {};
    try {
      parsedInput = JSON.parse(execution.input_data || '{}');
    } catch {
      addToast(e.fork_input_parse_error, 'error');
    }

    const forkInput = JSON.stringify({
      ...parsedInput,
      __fork_context: `Continuing from step ${state.forkPoint!}. Previous tool results:\n${context}`,
      __fork_source_execution: execution.id,
      __fork_step_index: state.forkPoint,
    }, null, 2);

    setRerunInputData(forkInput);
  }, [state.forkPoint, state.toolSteps, execution.id, execution.input_data, setRerunInputData, addToast, e.fork_input_parse_error]);

  const activeStepIndex = state.activeStep?.step_index ?? null;

  return (
    <div className="flex flex-col rounded-modal border border-primary/10 bg-background/50 overflow-hidden" style={{ height: 520 }}>
      {/* Transport controls */}
      <div className="px-4 py-3 border-b border-primary/10 space-y-2.5">
        <TimelineScrubber
          silences={state.silences}
          hasRecordedTempo={state.hasRecordedTempo}
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
            isLoading={logLoading}
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
