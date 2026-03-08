import { useState, useMemo } from 'react';
import type { DbPersonaExecution } from '@/lib/types/types';
import { usePersonaStore } from '@/stores/personaStore';
import { Activity } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDuration } from '@/lib/utils/formatters';
import { parseToolSteps, buildSyntheticTrace } from '../libs/waterfallHelpers';
import { StageBar, SubSpanBar } from './WaterfallStage';
import { CostAccrualOverlay, PipelineSummary, WaterfallErrors } from './WaterfallTimeline';

interface PipelineWaterfallProps {
  execution: DbPersonaExecution;
}

export function PipelineWaterfall({ execution }: PipelineWaterfallProps) {
  const liveTrace = usePersonaStore((s) => s.pipelineTrace);
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

  if (!trace || trace.entries.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-secondary/60 border border-primary/15 flex items-center justify-center">
          <Activity className="w-6 h-6 text-muted-foreground/60" />
        </div>
        <p className="text-sm text-muted-foreground/80">No pipeline trace available</p>
        <p className="text-sm text-muted-foreground/60 mt-1">Pipeline traces are captured for new executions</p>
      </div>
    );
  }

  const totalDurationMs = trace.completedAt ? trace.completedAt - trace.startedAt : (
    trace.entries.reduce((max, e) => Math.max(max, (e.timestamp - trace.startedAt) + (e.durationMs ?? 0)), 0)
  );
  const isLive = liveTrace?.executionId === execution.id;

  // Find stream_output entry for sub-span anchoring
  const streamEntry = trace.entries.find(e => e.stage === 'stream_output');

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground/60">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-blue-500/50" /> Frontend
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-emerald-500/50" /> Backend
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-amber-500/50" /> Engine
        </div>
        {toolSteps.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-cyan-500/35" /> Tool Call
          </div>
        )}
        {isLive && (
          <span className="ml-auto flex items-center gap-1 text-blue-400">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            Live
          </span>
        )}
      </div>

      <PipelineSummary trace={trace} execution={execution} />

      {/* Waterfall chart */}
      <div className="rounded-xl border border-primary/15 bg-secondary/30 overflow-hidden">
        {/* Time axis header */}
        <div className="grid grid-cols-[180px_1fr_70px] gap-2 px-3 py-1.5 border-b border-primary/10 bg-secondary/40">
          <div className="text-sm font-mono text-muted-foreground/60 uppercase tracking-wider">
            Stage
          </div>
          <div className="flex justify-between text-sm font-mono text-muted-foreground/60 uppercase tracking-wider">
            <span>0ms</span>
            <span>{formatDuration(totalDurationMs)}</span>
          </div>
          <div className="text-sm font-mono text-muted-foreground/60 uppercase tracking-wider text-right">
            Duration
          </div>
        </div>

        {/* Stage rows */}
        <div className="divide-y divide-primary/5">
          {trace.entries.map((entry) => {
            const hasSubSpans = entry.stage === 'stream_output' && toolSteps.length > 0;
            const isExpanded = expandedStages.has(entry.stage);

            return (
              <div key={entry.stage}>
                <StageBar
                  entry={entry}
                  totalDurationMs={totalDurationMs}
                  pipelineStartMs={trace.startedAt}
                  isExpanded={isExpanded}
                  onToggle={() => toggleStage(entry.stage)}
                  hasSubSpans={hasSubSpans}
                />

                <AnimatePresence>
                  {hasSubSpans && isExpanded && streamEntry && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15 }}
                      className="bg-secondary/10"
                    >
                      {toolSteps.map((step) => (
                        <SubSpanBar
                          key={step.step_index}
                          step={step}
                          parentStartMs={streamEntry.timestamp}
                          totalDurationMs={totalDurationMs}
                          pipelineStartMs={trace.startedAt}
                        />
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* Cost accrual overlay */}
        {execution.cost_usd > 0 && (
          <div className="border-t border-primary/10">
            <CostAccrualOverlay
              entries={trace.entries}
              totalDurationMs={totalDurationMs}
              pipelineStartMs={trace.startedAt}
              totalCostUsd={execution.cost_usd}
            />
          </div>
        )}
      </div>

      {/* Error details */}
      <WaterfallErrors entries={trace.entries} />
    </div>
  );
}
