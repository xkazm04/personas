import { useMemo } from 'react';
import { Wrench, GitFork } from 'lucide-react';
import type { ToolCallStep } from '@/hooks/execution/useReplayTimeline';
import { formatDuration } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

/** Tool inspector panel -- tool cards with active/completed/pending states. */
export function ReplayToolPanel({
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
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const completedSet = useMemo(() => new Set(completedSteps.map((s) => s.step_index)), [completedSteps]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hair">
        <Wrench className="w-3.5 h-3.5 text-ink-1" />
        <span className="typo-heading text-ink-1">{e.tool_steps}</span>
        <span className="ml-auto typo-body tabular-nums text-ink-1">
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
              className={`relative rounded-modal border px-3 py-2 transition-all ${
                isFork
                  ? 'border-status-warning/50 bg-status-warning/10 ring-1 ring-status-warning/30'
                  : isActive
                    ? 'border-status-info/40 bg-status-info/10 ring-1 ring-status-info/20'
                    : isCompleted
                      ? 'border-status-success/20 bg-status-success/5'
                      : 'border-hair bg-surface-1 opacity-60'
              }`}
            >
              <div className="flex items-center gap-2">
                {/* Step number */}
                <span className={`typo-code tabular-nums ${
                  isActive ? 'text-status-info' : isCompleted ? 'text-status-success' : 'text-ink-1'
                }`}>
                  {step.step_index}
                </span>

                {/* Status indicator */}
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  isActive
                    ? 'bg-status-info animate-pulse'
                    : isCompleted
                      ? 'bg-status-success'
                      : 'bg-muted-foreground/20'
                }`} />

                {/* Tool name */}
                <span className={`typo-code truncate ${
                  isPending ? 'text-ink-3' : 'text-ink-1'
                }`}>
                  {step.tool_name}
                </span>

                {/* Duration */}
                {step.duration_ms != null && isCompleted && (
                  <span className="ml-auto typo-code text-ink-1 tabular-nums">
                    {formatDuration(Number(step.duration_ms))}
                  </span>
                )}

                {/* Fork marker */}
                {isFork && (
                  <GitFork className="w-3 h-3 text-status-warning shrink-0" />
                )}
              </div>

              {/* Fork toggle on click */}
              {(isCompleted || isActive) && (
                <Tooltip content={isFork ? e.clear_fork_point : tx(e.fork_after_step, { step: step.step_index })}><button
                  type="button"
                  aria-label={isFork ? e.clear_fork_point : tx(e.fork_after_step, { step: step.step_index })}
                  onClick={() => onFork(isFork ? null : step.step_index)}
                  className="absolute inset-0 rounded-card" /></Tooltip>
              )}
            </div>
          );
        })}
        {toolSteps.length === 0 && (
          <div className="text-center py-6 typo-body text-ink-1">{e.no_tool_calls_recorded}</div>
        )}
      </div>
    </div>
  );
}
