import { useState, useMemo } from 'react';
import type { PersonaExecution } from '@/lib/types/types';
import type { PipelineStage } from '@/lib/execution/pipeline';
import { isPipelineStage, STAGE_META } from '@/lib/execution/pipeline';
import { useAgentStore } from "@/stores/agentStore";
import { AlertCircle, Activity } from 'lucide-react';
import { formatDuration } from '@/lib/utils/formatters';

import { STAGE_COLORS, parseToolSteps } from '../trace/stageColors';
import { buildSyntheticTrace } from '../trace/SyntheticTrace';
import { StageBar } from '../trace/StageBar';
import { SubSpanBar } from '../trace/SubSpanBar';
import { CostAccrualOverlay } from './CostAccrualOverlay';
import { PipelineSummary } from './PipelineSummary';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface PipelineWaterfallProps {
  execution: PersonaExecution;
}

export function PipelineWaterfall({ execution }: PipelineWaterfallProps) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const liveTrace = useAgentStore((s) => s.pipelineTrace);
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());

  // Use live trace if it matches this execution, otherwise build synthetic
  const trace = useMemo(() => {
    if (liveTrace && liveTrace.executionId === execution.id) {
      return liveTrace;
    }
    return buildSyntheticTrace(execution);
  }, [liveTrace, execution]);

  const toolSteps = useMemo(() => parseToolSteps(execution.tool_steps ?? null), [execution.tool_steps]);

  const toggleStage = (stage: string) => {
    setExpandedStages(prev => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  if (!trace || trace.spans.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="w-12 h-12 mx-auto mb-3 rounded-modal bg-secondary/60 border border-primary/20 flex items-center justify-center">
          <Activity className="w-6 h-6 text-foreground" />
        </div>
        <p className="typo-body text-foreground">{e.no_pipeline_trace}</p>
        <p className="typo-body text-foreground mt-1">{e.pipeline_traces_captured}</p>
      </div>
    );
  }

  const totalDurationMs = trace.completedAt ? trace.completedAt - trace.startedAt : (
    trace.spans.reduce((max, e) => Math.max(max, e.start_ms + (e.duration_ms ?? 0)), 0)
  );
  const isLive = liveTrace?.executionId === execution.id;

  // Find stream_output entry for sub-span anchoring
  const streamEntry = trace.spans.find(e => e.span_type === 'stream_output');

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex items-center gap-4 typo-body text-foreground">
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
          <div className="typo-code text-foreground uppercase tracking-wider">
            {e.stage}
          </div>
          <div className="flex justify-between typo-code text-foreground uppercase tracking-wider">
            <span>{e.zero_ms}</span>
            <span>{formatDuration(totalDurationMs)}</span>
          </div>
          <div className="typo-code text-foreground uppercase tracking-wider text-right">
            {e.duration}
          </div>
        </div>

        {/* Stage rows */}
        <div className="divide-y divide-primary/5">
          {trace.spans.filter(s => isPipelineStage(s.span_type)).map((entry) => {
            const hasSubSpans = entry.span_type === 'stream_output' && toolSteps.length > 0;
            const isExpanded = expandedStages.has(entry.span_type);

            return (
              <div key={entry.span_type}>
                <StageBar
                  entry={entry}
                  totalDurationMs={totalDurationMs}
                  isExpanded={isExpanded}
                  onToggle={() => toggleStage(entry.span_type)}
                  hasSubSpans={hasSubSpans}
                />

                {/* Sub-spans (tool calls within stream_output) */}
                {hasSubSpans && isExpanded && streamEntry && (
                    <div
                      className="animate-fade-slide-in bg-secondary/10"
                    >
                      {toolSteps.map((step) => (
                        <SubSpanBar
                          key={step.step_index}
                          step={step}
                          parentStartMs={trace.startedAt + streamEntry.start_ms}
                          totalDurationMs={totalDurationMs}
                          pipelineStartMs={trace.startedAt}
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
              entries={trace.spans.filter(s => isPipelineStage(s.span_type))}
              totalDurationMs={totalDurationMs}
              pipelineStartMs={trace.startedAt}
              totalCostUsd={execution.cost_usd}
            />
          </div>
        )}
      </div>

      {/* Error details */}
      {trace.spans.some(e => e.error) && (
        <div className="space-y-2">
          <div className="typo-code text-foreground uppercase tracking-wider flex items-center gap-1">
            <AlertCircle className="w-2.5 h-2.5 text-red-400" /> {e.stage_errors}
          </div>
          {trace.spans
            .filter(e => e.error)
            .map((entry) => {
              const sk = entry.span_type as PipelineStage;
              const config = STAGE_COLORS[sk];
              const meta = STAGE_META[sk];
              return (
                <div key={entry.span_type} className="p-3 bg-red-500/5 border border-red-500/15 rounded-card">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`inline-flex px-1.5 py-0.5 typo-code uppercase rounded border ${config.bg} ${config.text} ${config.border}`}>
                      {meta.label}
                    </span>
                  </div>
                  <pre className="typo-code text-red-300/80 whitespace-pre-wrap break-words">
                    {entry.error}
                  </pre>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
