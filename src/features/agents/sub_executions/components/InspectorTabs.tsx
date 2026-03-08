import { Fragment, useMemo } from 'react';
import type { DbPersonaExecution } from '@/lib/types/types';
import { Wrench, Clock, DollarSign, Zap } from 'lucide-react';
import { formatDuration } from '@/lib/utils/formatters';
import { parseToolSteps, formatCost, formatTimeGap } from '../libs/inspectorHelpers';
import { ToolCallCard, CostBreakdownBar } from './InspectorPayload';

interface InspectorTabsProps {
  execution: DbPersonaExecution;
}

export function InspectorTabs({ execution }: InspectorTabsProps) {
  const steps = useMemo(() => parseToolSteps(execution.tool_steps ?? null), [execution.tool_steps]);
  const model = execution.model_used || 'claude-sonnet-4';

  // Timeline rail animation state
  const isLive = execution.status === 'running' || execution.status === 'queued';
  const hasErrors = execution.status === 'failed';
  const completedCount = steps.filter((s) => s.ended_at_ms != null).length;
  const railFillPct = steps.length > 0
    ? isLive
      ? Math.max((completedCount / steps.length) * 100, 10)
      : 100
    : 0;
  const railGradient = hasErrors
    ? 'linear-gradient(to bottom, rgb(59 130 246 / 0.6), rgb(239 68 68 / 0.6))'
    : isLive
      ? 'linear-gradient(to bottom, rgb(59 130 246 / 0.6), rgb(245 158 11 / 0.6))'
      : 'linear-gradient(to bottom, rgb(59 130 246 / 0.6), rgb(16 185 129 / 0.6))';

  return (
    <div className="space-y-6">
      {/* Metrics Summary Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 3xl:gap-5 4xl:gap-6">
        <div className="rounded-xl border border-primary/15 bg-secondary/40 p-4 space-y-1.5">
          <div className="text-sm font-mono text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
            <Zap className="w-3 h-3" />
            Input Tokens
          </div>
          <div className="text-lg font-mono text-foreground/90">
            {execution.input_tokens.toLocaleString()}
          </div>
        </div>

        <div className="rounded-xl border border-primary/15 bg-secondary/40 p-4 space-y-1.5">
          <div className="text-sm font-mono text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
            <Zap className="w-3 h-3" />
            Output Tokens
          </div>
          <div className="text-lg font-mono text-foreground/90">
            {execution.output_tokens.toLocaleString()}
          </div>
        </div>

        <div className="rounded-xl border border-primary/15 bg-secondary/40 p-4 space-y-1.5">
          <div className="text-sm font-mono text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
            <DollarSign className="w-3 h-3" />
            Cost
          </div>
          <div className="text-lg font-mono text-foreground/90">
            {formatCost(execution.cost_usd)}
          </div>
        </div>

        <div className="rounded-xl border border-primary/15 bg-secondary/40 p-4 space-y-1.5">
          <div className="text-sm font-mono text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Duration
          </div>
          <div className="text-lg font-mono text-foreground/90">
            {formatDuration(execution.duration_ms)}
          </div>
        </div>
      </div>

      {/* Cost Breakdown Bar */}
      <div className="rounded-xl border border-primary/15 bg-secondary/40 p-4">
        <CostBreakdownBar model={model} inputTokens={execution.input_tokens} outputTokens={execution.output_tokens} />
      </div>

      {/* Tool Call Timeline */}
      {steps.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-mono text-muted-foreground/80 uppercase tracking-wider flex items-center gap-1.5">
            <Wrench className="w-3 h-3" />
            Tool Call Timeline ({steps.length} steps)
          </div>

          <div className="relative pl-7">
            {/* Vertical timeline rail */}
            <div className="absolute left-[10px] top-5 bottom-5 w-[2px] rounded-full overflow-hidden">
              <div className="absolute inset-0 bg-primary/15" />
              <div
                className="absolute top-0 left-0 right-0 rounded-full"
                style={{
                  height: `${railFillPct}%`,
                  background: railGradient,
                  transition: 'height 300ms ease-out',
                }}
              />
            </div>

            {steps.map((step, i) => {
              const prev = steps[i - 1];
              const gapMs =
                prev?.ended_at_ms != null
                  ? step.started_at_ms - prev.ended_at_ms
                  : null;
              const isCompleted = step.ended_at_ms != null;
              const isActive = !isCompleted && isLive;

              return (
                <Fragment key={step.step_index}>
                  {i > 0 && (
                    <div className="relative h-6 flex items-center">
                      {gapMs != null && gapMs >= 10 && (
                        <span className="absolute left-[-16px] text-sm font-mono text-muted-foreground/35 leading-none bg-background z-10 px-0.5">
                          {formatTimeGap(gapMs)}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="relative">
                    <div
                      className={`absolute left-[-22px] top-[16px] w-2.5 h-2.5 rounded-full border-2 z-10 transition-colors duration-300 ${
                        isActive
                          ? 'border-blue-400 bg-blue-400 animate-pulse'
                          : isCompleted
                            ? hasErrors
                              ? 'border-red-400/60 bg-red-400/40'
                              : 'border-emerald-400/60 bg-emerald-400/40'
                            : 'border-primary/30 bg-background'
                      }`}
                    />
                    <ToolCallCard step={step} />
                  </div>
                </Fragment>
              );
            })}
          </div>
        </div>
      )}

      {steps.length === 0 && (
        <div className="text-center py-8">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/60 border border-primary/15 flex items-center justify-center">
            <Wrench className="w-6 h-6 text-muted-foreground/80" />
          </div>
          <p className="text-sm text-muted-foreground/90">No tool calls recorded</p>
          <p className="text-sm text-muted-foreground/80 mt-1">Tool steps appear after execution completes</p>
        </div>
      )}
    </div>
  );
}
