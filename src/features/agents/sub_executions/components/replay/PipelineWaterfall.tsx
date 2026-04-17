import { useState, useMemo } from 'react';
import type { PersonaExecution } from '@/lib/types/types';
import { useAgentStore } from "@/stores/agentStore";
import { Activity } from 'lucide-react';
import { formatDuration } from '@/lib/utils/formatters';
import { pipelineSpans } from '@/lib/execution/pipeline';
import { parseToolSteps } from '../../libs/waterfallHelpers';
import { StageBar, SubSpanBar } from './WaterfallStage';
import { CostAccrualOverlay, PipelineSummary, WaterfallErrors } from './WaterfallTimeline';
import { useTranslation } from '@/i18n/useTranslation';

interface PipelineWaterfallProps {
  execution: PersonaExecution;
}

export function PipelineWaterfall({ execution }: PipelineWaterfallProps) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const liveTrace = useAgentStore((s) => s.pipelineTrace);
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());

  // Use live trace if it matches this execution; no synthetic fallback needed
  const trace = useMemo(() => {
    if (liveTrace && liveTrace.executionId === execution.id) {
      return liveTrace;
    }
    return null;
  }, [liveTrace, execution.id]);

  const toolSteps = useMemo(() => parseToolSteps(execution.tool_steps ?? null), [execution.tool_steps]);

  const toggleStage = (stage: string) => {
    setExpandedStages(prev => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  // Extract pipeline stage spans from the unified trace
  const stageSpans = useMemo(() => trace ? pipelineSpans(trace) : [], [trace]);

  if (!trace || stageSpans.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="w-12 h-12 mx-auto mb-3 rounded-modal bg-secondary/60 border border-primary/20 flex items-center justify-center">
          <Activity className="w-6 h-6 text-muted-foreground/60" />
        </div>
        <p className="typo-body text-muted-foreground/80">{e.no_pipeline_trace}</p>
        <p className="typo-body text-muted-foreground/60 mt-1">{e.pipeline_traces_captured}</p>
      </div>
    );
  }

  const totalDurationMs = trace.completedAt ? trace.completedAt - trace.startedAt : (
    stageSpans.reduce((max, s) => Math.max(max, s.start_ms + (s.duration_ms ?? 0)), 0)
  );
  const isLive = liveTrace?.executionId === execution.id;

  // Find stream_output span for sub-span anchoring
  const streamSpan = stageSpans.find(s => s.span_type === 'stream_output');

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex items-center gap-4 typo-body text-muted-foreground/60">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-blue-500/50" /> {e.legend_frontend}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-emerald-500/50" /> {e.legend_backend}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-amber-500/50" /> {e.legend_engine}
        </div>
        {toolSteps.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-cyan-500/35" /> {e.legend_tool_call}
          </div>
        )}
        {isLive && (
          <span className="ml-auto flex items-center gap-1 text-blue-400">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            {e.live}
          </span>
        )}
      </div>

      <PipelineSummary trace={trace} execution={execution} />

      {/* Waterfall chart */}
      <div className="rounded-modal border border-primary/20 bg-secondary/30 overflow-hidden">
        {/* Time axis header */}
        <div className="grid grid-cols-[180px_1fr_70px] gap-2 px-3 py-1.5 border-b border-primary/10 bg-secondary/40">
          <div className="typo-code text-muted-foreground/60 uppercase tracking-wider">
            {e.stage}
          </div>
          <div className="flex justify-between typo-code text-muted-foreground/60 uppercase tracking-wider">
            <span>0ms</span>
            <span>{formatDuration(totalDurationMs)}</span>
          </div>
          <div className="typo-code text-muted-foreground/60 uppercase tracking-wider text-right">
            {e.duration}
          </div>
        </div>

        {/* Stage rows */}
        <div className="divide-y divide-primary/5">
          {stageSpans.map((span) => {
            const hasSubSpans = span.span_type === 'stream_output' && toolSteps.length > 0;
            const isExpanded = expandedStages.has(span.span_type);

            return (
              <div key={span.span_id}>
                <StageBar
                  entry={span}
                  totalDurationMs={totalDurationMs}
                  isExpanded={isExpanded}
                  onToggle={() => toggleStage(span.span_type)}
                  hasSubSpans={hasSubSpans}
                />

                {hasSubSpans && isExpanded && streamSpan && (
                    <div
                      className="animate-fade-slide-in bg-secondary/10"
                    >
                      {toolSteps.map((step) => (
                        <SubSpanBar
                          key={step.step_index}
                          step={step}
                          parentStartMs={streamSpan.start_ms}
                          totalDurationMs={totalDurationMs}
                        />
                      ))}
                    </div>
                  )}
              </div>
            );
          })}
        </div>

        {/* Cost accrual overlay */}
        {execution.cost_usd > 0 && (
          <div className="border-t border-primary/10">
            <CostAccrualOverlay
              entries={stageSpans}
              totalDurationMs={totalDurationMs}
              totalCostUsd={execution.cost_usd}
            />
          </div>
        )}
      </div>

      {/* Error details */}
      <WaterfallErrors entries={stageSpans} />
    </div>
  );
}
