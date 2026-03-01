import { useState, useMemo } from 'react';
import type { DbPersonaExecution } from '@/lib/types/types';
import type { PipelineTrace, PipelineTraceEntry, PipelineStage } from '@/lib/execution/pipeline';
import { PIPELINE_STAGES, STAGE_META } from '@/lib/execution/pipeline';
import { usePersonaStore } from '@/stores/personaStore';
import {
  Clock, DollarSign, Zap, AlertCircle,
  ChevronDown, ChevronRight, Activity,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { formatDuration } from '@/lib/utils/formatters';

// ---------------------------------------------------------------------------
// Stage color scheme
// ---------------------------------------------------------------------------

const STAGE_COLORS: Record<PipelineStage, { bar: string; text: string; bg: string; border: string; category: string }> = {
  initiate:           { bar: 'bg-blue-500/50',    text: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/25',    category: 'Frontend' },
  validate:           { bar: 'bg-emerald-500/50', text: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', category: 'Backend' },
  create_record:      { bar: 'bg-emerald-500/50', text: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', category: 'Backend' },
  spawn_engine:       { bar: 'bg-amber-500/50',   text: 'text-amber-400',   bg: 'bg-amber-500/15',   border: 'border-amber-500/25',   category: 'Engine' },
  stream_output:      { bar: 'bg-amber-500/50',   text: 'text-amber-400',   bg: 'bg-amber-500/15',   border: 'border-amber-500/25',   category: 'Engine' },
  finalize_status:    { bar: 'bg-emerald-500/50', text: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', category: 'Backend' },
  frontend_complete:  { bar: 'bg-blue-500/50',    text: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/25',    category: 'Frontend' },
};

// ---------------------------------------------------------------------------
// Tool step sub-span type
// ---------------------------------------------------------------------------

interface ToolCallStep {
  step_index: number;
  tool_name: string;
  input_preview: string;
  output_preview: string;
  started_at_ms: number;
  ended_at_ms?: number;
  duration_ms?: number;
}

function parseToolSteps(raw: string | null): ToolCallStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Synthetic trace builder (for historical executions without live trace)
// ---------------------------------------------------------------------------

function buildSyntheticTrace(execution: DbPersonaExecution): PipelineTrace | null {
  if (!execution.started_at && !execution.created_at) return null;

  const startTime = new Date(execution.started_at ?? execution.created_at).getTime();
  const endTime = execution.completed_at
    ? new Date(execution.completed_at).getTime()
    : execution.duration_ms
      ? startTime + execution.duration_ms
      : null;

  if (!endTime) return null;

  const totalDuration = endTime - startTime;
  if (totalDuration <= 0) return null;

  // Estimate stage durations based on typical proportions
  const entries: PipelineTraceEntry[] = [];
  let cursor = startTime;

  // initiate: ~1% (quick frontend dispatch)
  const initDur = Math.max(totalDuration * 0.01, 5);
  entries.push({ stage: 'initiate', timestamp: cursor, durationMs: initDur, metadata: { personaId: execution.persona_id } });
  cursor += initDur;

  // validate: ~2%
  const validateDur = Math.max(totalDuration * 0.02, 10);
  entries.push({ stage: 'validate', timestamp: cursor, durationMs: validateDur });
  cursor += validateDur;

  // create_record: ~1%
  const createDur = Math.max(totalDuration * 0.01, 5);
  entries.push({ stage: 'create_record', timestamp: cursor, durationMs: createDur, metadata: { executionId: execution.id } });
  cursor += createDur;

  // spawn_engine: ~1%
  const spawnDur = Math.max(totalDuration * 0.01, 10);
  entries.push({ stage: 'spawn_engine', timestamp: cursor, durationMs: spawnDur });
  cursor += spawnDur;

  // stream_output: ~90% (the bulk)
  const streamDur = endTime - cursor - Math.max(totalDuration * 0.03, 20);
  entries.push({ stage: 'stream_output', timestamp: cursor, durationMs: Math.max(streamDur, 50) });
  cursor += Math.max(streamDur, 50);

  // finalize_status: ~2%
  const finalizeDur = Math.max(totalDuration * 0.02, 10);
  entries.push({
    stage: 'finalize_status',
    timestamp: cursor,
    durationMs: finalizeDur,
    error: execution.error_message ?? undefined,
  });
  cursor += finalizeDur;

  // frontend_complete: ~1%
  const feCompleteDur = Math.max(endTime - cursor, 5);
  entries.push({
    stage: 'frontend_complete',
    timestamp: cursor,
    durationMs: feCompleteDur,
    metadata: { status: execution.status },
  });

  return {
    executionId: execution.id,
    entries,
    startedAt: startTime,
    completedAt: endTime,
  };
}

// ---------------------------------------------------------------------------
// Waterfall Bar
// ---------------------------------------------------------------------------

function StageBar({
  entry,
  totalDurationMs,
  pipelineStartMs,
  isExpanded,
  onToggle,
  hasSubSpans,
}: {
  entry: PipelineTraceEntry;
  totalDurationMs: number;
  pipelineStartMs: number;
  isExpanded: boolean;
  onToggle: () => void;
  hasSubSpans: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const config = STAGE_COLORS[entry.stage];
  const meta = STAGE_META[entry.stage];
  const offsetMs = entry.timestamp - pipelineStartMs;
  const durationMs = entry.durationMs ?? 0;
  const leftPct = totalDurationMs > 0 ? (offsetMs / totalDurationMs) * 100 : 0;
  const widthPct = totalDurationMs > 0 ? Math.max((durationMs / totalDurationMs) * 100, 0.5) : 0;

  return (
    <div
      className="group"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="grid grid-cols-[180px_1fr_70px] gap-2 items-center px-3 py-1.5 hover:bg-secondary/30 rounded transition-colors">
        {/* Left: stage label */}
        <div className="flex items-center gap-1.5 min-w-0">
          {hasSubSpans ? (
            <button onClick={onToggle} className="p-0.5 rounded hover:bg-primary/10 flex-shrink-0">
              {isExpanded ? (
                <ChevronDown className="w-3 h-3 text-muted-foreground/70" />
              ) : (
                <ChevronRight className="w-3 h-3 text-muted-foreground/70" />
              )}
            </button>
          ) : (
            <span className="w-4 flex-shrink-0" />
          )}
          <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase rounded border ${config.bg} ${config.text} ${config.border} flex-shrink-0`}>
            {config.category}
          </span>
          <span className="text-xs font-medium text-foreground/85 truncate">{meta.label}</span>
          {entry.error && <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />}
        </div>

        {/* Center: waterfall bar */}
        <div className="relative h-6 w-full">
          <div className="absolute inset-0 bg-primary/5 rounded" />
          <div
            className={`absolute top-1 bottom-1 rounded ${entry.error ? 'bg-red-500/40' : config.bar} transition-all`}
            style={{
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              minWidth: '3px',
            }}
          />
          {/* Hover tooltip */}
          {hovered && (
            <div
              className="absolute z-20 bottom-full mb-1 bg-background/95 border border-primary/20 rounded-lg px-3 py-2 shadow-lg backdrop-blur-sm whitespace-nowrap pointer-events-none"
              style={{ left: `${Math.min(leftPct, 70)}%` }}
            >
              <p className="text-xs font-medium text-foreground/90 mb-1">{meta.label}</p>
              <p className="text-[10px] text-muted-foreground/60 mb-1">{meta.boundary}</p>
              <div className="flex items-center gap-3 text-[10px]">
                <span className="font-mono text-foreground/70">{formatDuration(durationMs)}</span>
                <span className="text-muted-foreground/50">offset: {formatDuration(offsetMs)}</span>
              </div>
              {entry.metadata && Object.keys(entry.metadata).length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {Object.entries(entry.metadata).map(([k, v]) => (
                    <div key={k} className="text-[10px] text-muted-foreground/60">
                      <span className="text-muted-foreground/40">{k}:</span>{' '}
                      <span className="font-mono">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: duration */}
        <span className="text-xs font-mono text-muted-foreground/70 text-right">
          {formatDuration(durationMs)}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-span bar (tool calls within stream_output)
// ---------------------------------------------------------------------------

function SubSpanBar({
  step,
  parentStartMs,
  totalDurationMs,
  pipelineStartMs,
}: {
  step: ToolCallStep;
  parentStartMs: number;
  totalDurationMs: number;
  pipelineStartMs: number;
}) {
  const [hovered, setHovered] = useState(false);
  const stepOffsetInParent = step.started_at_ms;
  const stepDuration = step.duration_ms ?? 0;
  const absoluteStart = parentStartMs + stepOffsetInParent;
  const offsetFromPipeline = absoluteStart - pipelineStartMs;
  const leftPct = totalDurationMs > 0 ? (offsetFromPipeline / totalDurationMs) * 100 : 0;
  const widthPct = totalDurationMs > 0 ? Math.max((stepDuration / totalDurationMs) * 100, 0.3) : 0;

  return (
    <div
      className="grid grid-cols-[180px_1fr_70px] gap-2 items-center px-3 py-0.5 hover:bg-secondary/20 rounded transition-colors"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Left: indented tool name */}
      <div className="flex items-center gap-1.5 min-w-0 pl-8">
        <span className="w-4 flex-shrink-0" />
        <span className="inline-flex px-1.5 py-0.5 text-[9px] font-mono uppercase rounded border bg-cyan-500/10 text-cyan-400 border-cyan-500/20 flex-shrink-0">
          Tool
        </span>
        <span className="text-[11px] font-mono text-foreground/70 truncate">{step.tool_name}</span>
      </div>

      {/* Center: bar */}
      <div className="relative h-4 w-full">
        <div className="absolute inset-0 bg-primary/3 rounded" />
        <div
          className="absolute top-0.5 bottom-0.5 rounded bg-cyan-500/35 transition-all"
          style={{
            left: `${leftPct}%`,
            width: `${widthPct}%`,
            minWidth: '2px',
          }}
        />
        {hovered && (
          <div
            className="absolute z-20 bottom-full mb-1 bg-background/95 border border-primary/20 rounded-lg px-3 py-2 shadow-lg backdrop-blur-sm whitespace-nowrap pointer-events-none"
            style={{ left: `${Math.min(leftPct, 70)}%` }}
          >
            <p className="text-xs font-medium text-cyan-400 mb-1">{step.tool_name}</p>
            <div className="flex items-center gap-3 text-[10px]">
              <span className="font-mono text-foreground/70">{formatDuration(stepDuration)}</span>
              <span className="text-muted-foreground/50">step #{step.step_index}</span>
            </div>
            {step.input_preview && (
              <p className="text-[10px] text-muted-foreground/50 mt-1 max-w-[200px] truncate">
                in: {step.input_preview}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Right: duration */}
      <span className="text-[11px] font-mono text-muted-foreground/50 text-right">
        {formatDuration(stepDuration)}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cost Accrual Overlay (SVG curve on the waterfall)
// ---------------------------------------------------------------------------

function CostAccrualOverlay({
  entries,
  totalDurationMs,
  pipelineStartMs,
  totalCostUsd,
}: {
  entries: PipelineTraceEntry[];
  totalDurationMs: number;
  pipelineStartMs: number;
  totalCostUsd: number;
}) {
  if (totalCostUsd <= 0 || totalDurationMs <= 0) return null;

  // Build cost accrual points: cost accrues during stream_output and finalize_status
  const points = useMemo(() => {
    const pts: Array<{ pct: number; costPct: number }> = [];
    let accrued = 0;

    pts.push({ pct: 0, costPct: 0 });

    for (const entry of entries) {
      const offsetMs = entry.timestamp - pipelineStartMs;
      const endMs = offsetMs + (entry.durationMs ?? 0);
      const startPct = (offsetMs / totalDurationMs) * 100;
      const endPct = (endMs / totalDurationMs) * 100;

      if (entry.stage === 'stream_output') {
        // Bulk of cost accrues here
        pts.push({ pct: startPct, costPct: (accrued / totalCostUsd) * 100 });
        accrued += totalCostUsd * 0.95; // ~95% of cost in streaming
        pts.push({ pct: endPct, costPct: (accrued / totalCostUsd) * 100 });
      } else if (entry.stage === 'finalize_status') {
        pts.push({ pct: startPct, costPct: (accrued / totalCostUsd) * 100 });
        accrued = totalCostUsd;
        pts.push({ pct: endPct, costPct: 100 });
      }
    }

    // Ensure we end at 100%
    const lastPt = pts[pts.length - 1];
    if (pts.length > 0 && lastPt && lastPt.costPct < 100) {
      pts.push({ pct: 100, costPct: 100 });
    }

    return pts;
  }, [entries, totalDurationMs, pipelineStartMs, totalCostUsd]);

  if (points.length < 2) return null;

  const svgW = 100;
  const svgH = 20;
  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(p.pct / 100) * svgW},${svgH - (p.costPct / 100) * svgH}`)
    .join(' ');
  const areaD = pathD + ` L${svgW},${svgH} L0,${svgH} Z`;

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2 mb-1">
        <DollarSign className="w-3 h-3 text-emerald-400" />
        <span className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider">
          Cost Accrual — ${totalCostUsd.toFixed(4)}
        </span>
      </div>
      <div className="h-5 bg-primary/5 rounded overflow-hidden">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          preserveAspectRatio="none"
          className="w-full h-full"
        >
          <path d={areaD} fill="rgba(16, 185, 129, 0.1)" />
          <path d={pathD} fill="none" stroke="rgba(16, 185, 129, 0.5)" strokeWidth="0.5" />
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary row
// ---------------------------------------------------------------------------

function PipelineSummary({ trace, execution }: { trace: PipelineTrace; execution: DbPersonaExecution }) {
  const totalMs = trace.completedAt ? trace.completedAt - trace.startedAt : 0;
  const stagesHit = trace.entries.length;
  const errors = trace.entries.filter(e => e.error).length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="rounded-lg border border-primary/15 bg-secondary/40 p-3 space-y-1">
        <div className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" /> Total Duration
        </div>
        <div className="text-sm font-mono text-foreground/90">{formatDuration(totalMs)}</div>
      </div>
      <div className="rounded-lg border border-primary/15 bg-secondary/40 p-3 space-y-1">
        <div className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <DollarSign className="w-2.5 h-2.5" /> Cost
        </div>
        <div className="text-sm font-mono text-foreground/90">
          {execution.cost_usd > 0 ? `$${execution.cost_usd.toFixed(4)}` : '-'}
        </div>
      </div>
      <div className="rounded-lg border border-primary/15 bg-secondary/40 p-3 space-y-1">
        <div className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <Zap className="w-2.5 h-2.5" /> Stages
        </div>
        <div className="text-sm font-mono text-foreground/90">{stagesHit} / {PIPELINE_STAGES.length}</div>
      </div>
      <div className="rounded-lg border border-primary/15 bg-secondary/40 p-3 space-y-1">
        <div className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <AlertCircle className="w-2.5 h-2.5" /> Errors
        </div>
        <div className={`text-sm font-mono ${errors > 0 ? 'text-red-400' : 'text-foreground/90'}`}>{errors}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

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
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground/60">
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
          <div className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider">
            Stage
          </div>
          <div className="flex justify-between text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider">
            <span>0ms</span>
            <span>{formatDuration(totalDurationMs)}</span>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground/60 uppercase tracking-wider text-right">
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

                {/* Sub-spans (tool calls within stream_output) */}
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
      {trace.entries.some(e => e.error) && (
        <div className="space-y-2">
          <div className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
            <AlertCircle className="w-2.5 h-2.5 text-red-400" /> Stage Errors
          </div>
          {trace.entries
            .filter(e => e.error)
            .map((entry) => {
              const config = STAGE_COLORS[entry.stage];
              const meta = STAGE_META[entry.stage];
              return (
                <div key={entry.stage} className="p-3 bg-red-500/5 border border-red-500/15 rounded-lg">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono uppercase rounded border ${config.bg} ${config.text} ${config.border}`}>
                      {meta.label}
                    </span>
                  </div>
                  <pre className="text-sm text-red-300/80 font-mono whitespace-pre-wrap break-words">
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
