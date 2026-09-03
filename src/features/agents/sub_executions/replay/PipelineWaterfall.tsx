import { useState, useMemo, useEffect } from 'react';
import type { PersonaExecution } from '@/lib/types/types';
import type { PipelineStage, UnifiedSpan, UnifiedSpanType } from '@/lib/execution/pipeline';
import { isPipelineStage, STAGE_META } from '@/lib/execution/pipeline';
import { useAgentStore } from "@/stores/agentStore";
import { AlertCircle, Activity } from 'lucide-react';
import { formatDuration } from '@/lib/utils/formatters';
import { getExecutionTrace } from '@/api/agents/executions';
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';
import { silentCatch } from '@/lib/silentCatch';

import { STAGE_COLORS, parseToolSteps } from '../trace/stageColors';
import { buildSyntheticTrace, buildHybridTrace } from '../trace/SyntheticTrace';
import { StageBar } from '../trace/StageBar';
import { SubSpanBar } from '../trace/SubSpanBar';
import { CostAccrualOverlay } from './CostAccrualOverlay';
import { PipelineSummary } from './PipelineSummary';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Stored-trace fetch
// ---------------------------------------------------------------------------

/**
 * Last stored trace read, per execution.
 *
 * This view unmounts whenever the operator leaves the tab, and re-reading a
 * finished execution's trace is pure waste -- a persisted trace never changes.
 * The cache exists so a re-open paints warm instead of ghosting again (law 4,
 * docs/design/overview-loading.md). `null` is a REAL cached answer -- "the
 * backend holds no trace for this execution" -- and is not re-fetched either.
 *
 * Keyed by execution id, so it must state its own ceiling.
 */
const storedTraceCache = createModuleCache<string, UnifiedSpan[] | null>({
  ttlMs: 10 * 60_000,
  maxSize: 100,
});

interface StoredTraceState {
  spans: UnifiedSpan[] | null;
  loading: boolean;
}

/**
 * Read the persisted trace's spans for an execution.
 *
 * `enabled` is false while the LIVE trace already covers this execution --
 * that path is untouched and needs no fetch. A failed read resolves to `null`
 * rather than an error surface: the caller then falls back to the fully
 * reconstructed synthetic trace, which is exactly what it drew before this
 * fetch existed.
 */
function useStoredTraceSpans(execution: PersonaExecution, enabled: boolean): StoredTraceState {
  const cacheKey = execution.id;
  const [state, setState] = useState<StoredTraceState>(() => {
    const warm = enabled ? storedTraceCache.get(cacheKey) : undefined;
    return warm !== undefined ? { spans: warm, loading: false } : { spans: null, loading: enabled };
  });

  useEffect(() => {
    if (!enabled) {
      setState({ spans: null, loading: false });
      return;
    }
    const warm = storedTraceCache.get(cacheKey);
    if (warm !== undefined) {
      setState({ spans: warm, loading: false });
      return;
    }

    let cancelled = false;
    setState({ spans: null, loading: true });
    void (async () => {
      try {
        const fetched = await getExecutionTrace(cacheKey, execution.persona_id);
        const spans: UnifiedSpan[] | null = fetched
          ? fetched.spans.map((sp) => ({
              span_id: sp.span_id,
              parent_span_id: sp.parent_span_id,
              span_type: sp.span_type as UnifiedSpanType,
              name: sp.name,
              start_ms: sp.start_ms,
              end_ms: sp.end_ms,
              duration_ms: sp.duration_ms,
              cost_usd: sp.cost_usd,
              error: sp.error,
              metadata: sp.metadata as Record<string, unknown> | null,
            }))
          : null;
        storedTraceCache.set(cacheKey, spans);
        if (!cancelled) setState({ spans, loading: false });
      } catch (err) {
        silentCatch('PipelineWaterfall:getExecutionTrace')(err);
        // Deliberately NOT cached: a failed read is not an answer about this
        // execution, and the next open should try again.
        if (!cancelled) setState({ spans: null, loading: false });
      }
    })();

    return () => { cancelled = true; };
  }, [cacheKey, execution.persona_id, enabled]);

  return state;
}

/**
 * Ghost stage rows. Geometry-matched to StageBar so the settled waterfall
 * occupies the space the ghost did, and rendered UNDER the axis chrome rather
 * than instead of it (law 1). Never a spinner.
 */
function StageGhostRows() {
  return (
    <div className="divide-y divide-primary/5" data-testid="pipeline-stage-ghost" aria-hidden="true">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="grid grid-cols-[180px_1fr_70px] gap-2 items-center px-3 py-1.5">
          <div className="h-3 rounded bg-primary/10" style={{ width: `${55 + ((i * 13) % 35)}%` }} />
          <div className="h-6 rounded bg-primary/5" />
          <div className="h-3 rounded bg-primary/10 justify-self-end w-10" />
        </div>
      ))}
    </div>
  );
}

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

  useEffect(() => {
    setExpandedStages(new Set());
  }, [execution.id]);

  const isLive = liveTrace?.executionId === execution.id;
  const stored = useStoredTraceSpans(execution, !isLive);

  // Three sources, in descending order of how much of the chart is measured:
  //   1. the LIVE trace, when this execution is the one running -- unchanged;
  //   2. the PERSISTED trace, which carries four real, closed backend stages
  //      plus three frontend stages nobody ever recorded -- a hybrid;
  //   3. `buildSyntheticTrace`, which guesses all seven from fixed percentage
  //      splits of the wall clock. Until this fetch existed EVERY historical
  //      execution landed there, and a run whose stream_output really took
  //      99.4% of its wall clock was drawn as a flat 90% guess.
  const trace = useMemo(() => {
    if (liveTrace && liveTrace.executionId === execution.id) {
      return liveTrace;
    }
    if (stored.spans) {
      const hybrid = buildHybridTrace(execution, stored.spans);
      if (hybrid) return hybrid;
    }
    return buildSyntheticTrace(execution);
  }, [liveTrace, execution, stored.spans]);

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
  // Reconstructed from execution timestamps, not captured live — every span
  // below is a proportional estimate, not a measurement. Distinct from
  // `isLive`: an execution can be neither (a historical trace WAS captured)
  // nor both (synthetic traces are never the live one).
  const isSynthetic = 'isSynthetic' in trace && trace.isSynthetic === true;
  // Which INDIVIDUAL bars are estimates. On a hybrid that is the three
  // frontend-only stages and nothing else; on a fully synthetic trace it is
  // every bar, and the chart-wide badge above says so instead.
  const estimatedStages: ReadonlySet<PipelineStage> =
    'estimatedStages' in trace
      ? (trace as { estimatedStages: ReadonlySet<PipelineStage> }).estimatedStages
      : new Set<PipelineStage>();
  const isHybrid = !isSynthetic && estimatedStages.size > 0;

  // Find stream_output entry for sub-span anchoring
  const streamEntry = trace.spans.find(e => e.span_type === 'stream_output');

  return (
    <div className="space-y-4">
      {/* Legend */}
      <div className="flex items-center gap-4 typo-body text-foreground">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-status-info/50" /> {e.legend_frontend}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-status-success/50" /> {e.legend_backend}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded bg-status-warning/50" /> {e.legend_engine}
        </div>
        {toolSteps.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded bg-status-neutral/40" /> {e.legend_tool_call}
          </div>
        )}
        {isLive && (
          <span className="ml-auto flex items-center gap-1 text-status-info">
            <span className="w-1.5 h-1.5 rounded-full bg-status-info animate-pulse" />
            {e.live}
          </span>
        )}
        {!isLive && isSynthetic && (
          <span
            className="ml-auto flex items-center gap-1 text-status-warning"
            data-testid="pipeline-synthetic-badge"
          >
            <AlertCircle className="w-3 h-3" />
            {e.estimated_no_trace}
          </span>
        )}
        {!isLive && isHybrid && (
          <span
            className="ml-auto flex items-center gap-1 text-status-warning"
            data-testid="pipeline-hybrid-badge"
          >
            <AlertCircle className="w-3 h-3" />
            {e.estimated_frontend_only}
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

        {/* Stage rows -- the ghost renders UNDER the axis chrome above, never
            instead of it, and only while nothing settled is on screen yet. */}
        {stored.loading ? <StageGhostRows /> : (
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
                  isEstimated={estimatedStages.has(entry.span_type as PipelineStage)}
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
        )}

        {/* Cost accrual overlay */}
        {execution.cost_usd != null && execution.cost_usd > 0 && !stored.loading && (
          <div className="border-t border-primary/10">
            <CostAccrualOverlay
              entries={trace.spans.filter(s => isPipelineStage(s.span_type))}
              totalDurationMs={totalDurationMs}
              totalCostUsd={execution.cost_usd}
              isSynthetic={isSynthetic}
              estimatedStages={estimatedStages}
            />
          </div>
        )}
      </div>

      {/* Error details */}
      {trace.spans.some(s => s.error) && (
        <div className="space-y-2">
          <div className="typo-code text-foreground uppercase tracking-wider flex items-center gap-1">
            <AlertCircle className="w-2.5 h-2.5 text-red-400" /> {e.stage_errors}
          </div>
          {trace.spans
            .filter(s => s.error)
            .map((entry) => {
              const isStage = isPipelineStage(entry.span_type);
              const config = isStage ? STAGE_COLORS[entry.span_type as PipelineStage] : null;
              const meta = isStage ? STAGE_META[entry.span_type as PipelineStage] : null;
              const label = meta?.label ?? entry.name ?? entry.span_type;
              return (
                <div key={entry.span_id} className="p-3 bg-red-500/5 border border-red-500/15 rounded-card">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`inline-flex px-1.5 py-0.5 typo-code uppercase rounded border ${
                      config
                        ? `${config.bg} ${config.text} ${config.border}`
                        : 'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>
                      {label}
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
