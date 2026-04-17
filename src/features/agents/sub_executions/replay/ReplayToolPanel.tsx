import { useMemo } from 'react';
import { Wrench, GitFork } from 'lucide-react';
import type { ToolCallStep } from '@/hooks/execution/useReplayTimeline';
import { formatDuration } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

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
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
        <Wrench className="w-3.5 h-3.5 text-foreground" />
        <span className="typo-heading text-foreground">{e.tool_steps}</span>
        <span className="ml-auto typo-body tabular-nums text-foreground">
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
                <span className={`typo-code tabular-nums ${
                  isActive ? 'text-blue-400' : isCompleted ? 'text-emerald-400' : 'text-foreground'
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
                <span className={`typo-code truncate ${
                  isPending ? 'text-foreground' : 'text-foreground'
                }`}>
                  {step.tool_name}
                </span>

                {/* Duration */}
                {step.duration_ms != null && isCompleted && (
                  <span className="ml-auto typo-code text-foreground tabular-nums">
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
                  className="absolute inset-0 rounded-card"
                  title={isFork ? e.clear_fork_point : tx(e.fork_after_step, { step: step.step_index + 1 })}
                />
              )}
            </div>
          );
        })}
        {toolSteps.length === 0 && (
          <div className="text-center py-6 typo-body text-foreground">{e.no_tool_calls_recorded}</div>
        )}
      </div>
    </div>
  );
}
