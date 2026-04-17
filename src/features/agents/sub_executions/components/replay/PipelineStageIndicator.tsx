import { useMemo } from 'react';
import { CheckCircle2, Circle, Loader2, AlertCircle } from 'lucide-react';
import { PIPELINE_STAGES, STAGE_META, type PipelineStage } from '@/lib/execution/pipeline';
import { STAGE_COLORS } from '../../libs/waterfallHelpers';
import { useTranslation } from '@/i18n/useTranslation';

interface PipelineStageIndicatorProps {
  /** Current scrub position in ms. */
  currentMs: number;
  /** Total execution duration in ms. */
  totalMs: number;
  /** Stage boundaries as { stage, startMs, endMs }. */
  stageBoundaries: StageBoundary[];
  /** Whether execution failed. */
  isFailed: boolean;
  /** The stage where the error occurred (if failed). */
  errorStage: PipelineStage | null;
}

export interface StageBoundary {
  stage: PipelineStage;
  startMs: number;
  endMs: number;
}

/**
 * Derive which pipeline stage is active at a given ms position.
 */
export function currentStageAt(ms: number, boundaries: StageBoundary[]): PipelineStage | null {
  for (let i = boundaries.length - 1; i >= 0; i--) {
    const b = boundaries[i]!;
    if (ms >= b.startMs) return b.stage;
  }
  return boundaries[0]?.stage ?? null;
}

/**
 * Build stage boundaries from tool_steps timing + total duration.
 * Maps the 7 pipeline stages to proportional time regions.
 */
export function buildStageBoundaries(totalMs: number): StageBoundary[] {
  if (totalMs <= 0) return [];

  // Default proportional split if no trace data available:
  // initiate(2%), validate(3%), create_record(2%), spawn_engine(3%), stream_output(80%), finalize_status(5%), frontend_complete(5%)
  const proportions = [0.02, 0.03, 0.02, 0.03, 0.80, 0.05, 0.05];
  let offset = 0;

  return PIPELINE_STAGES.map((stage, i) => {
    const duration = totalMs * proportions[i]!;
    const boundary: StageBoundary = {
      stage,
      startMs: offset,
      endMs: offset + duration,
    };
    offset += duration;
    return boundary;
  });
}

/**
 * Build stage boundaries from a UnifiedTrace's actual span data.
 */
export function buildStageBoundariesFromSpans(
  spans: Array<{ span_type: string; start_ms: number; end_ms: number | null; duration_ms: number | null }>,
  totalMs: number,
): StageBoundary[] {
  const boundaries: StageBoundary[] = [];

  for (const stage of PIPELINE_STAGES) {
    const span = spans.find((s) => s.span_type === stage);
    if (span) {
      boundaries.push({
        stage,
        startMs: span.start_ms,
        endMs: span.end_ms ?? span.start_ms + (span.duration_ms ?? 0),
      });
    }
  }

  // If we got some but not all stages, fill from proportional defaults
  if (boundaries.length === 0) return buildStageBoundaries(totalMs);
  return boundaries;
}

export function PipelineStageIndicator({
  currentMs,
  totalMs,
  stageBoundaries,
  isFailed,
  errorStage,
}: PipelineStageIndicatorProps) {
  const { t, tx } = useTranslation();
  const activeStage = useMemo(
    () => currentStageAt(currentMs, stageBoundaries),
    [currentMs, stageBoundaries],
  );

  const stageStates = useMemo(() => {
    return PIPELINE_STAGES.map((stage) => {
      const boundary = stageBoundaries.find((b) => b.stage === stage);
      if (!boundary) return 'pending' as const;
      if (isFailed && errorStage === stage) return 'error' as const;
      if (currentMs >= boundary.endMs) return 'completed' as const;
      if (currentMs >= boundary.startMs) return 'active' as const;
      return 'pending' as const;
    });
  }, [currentMs, stageBoundaries, isFailed, errorStage]);

  if (stageBoundaries.length === 0) return null;

  return (
    <div className="flex items-center gap-0.5 w-full">
      {PIPELINE_STAGES.map((stage, i) => {
        const state = stageStates[i]!;
        const colors = STAGE_COLORS[stage];
        const meta = STAGE_META[stage];
        const isActive = activeStage === stage;
        const boundary = stageBoundaries.find((b) => b.stage === stage);
        const widthPct = boundary && totalMs > 0
          ? Math.max(((boundary.endMs - boundary.startMs) / totalMs) * 100, 3)
          : 100 / PIPELINE_STAGES.length;

        return (
          <div
            key={stage}
            className="relative group"
            style={{ width: `${widthPct}%` }}
          >
            {/* Stage bar */}
            <div
              className={`h-7 rounded-input border transition-all flex items-center justify-center gap-1 px-1 overflow-hidden ${
                state === 'error'
                  ? 'bg-red-500/15 border-red-500/30'
                  : state === 'active'
                    ? `${colors.bg} ${colors.border} ring-1 ring-${stage === 'stream_output' ? 'amber' : 'blue'}-400/20`
                    : state === 'completed'
                      ? `${colors.bg} ${colors.border} opacity-80`
                      : 'bg-secondary/20 border-primary/10 opacity-40'
              }`}
            >
              {/* Status icon */}
              {state === 'error' ? (
                <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
              ) : state === 'active' ? (
                <div className="animate-fade-in"
                >
                  <Loader2 className={`w-3 h-3 ${colors.text} shrink-0`} />
                </div>
              ) : state === 'completed' ? (
                <CheckCircle2 className={`w-3 h-3 ${colors.text} shrink-0`} />
              ) : (
                <Circle className="w-3 h-3 text-muted-foreground/30 shrink-0" />
              )}

              {/* Stage label (hidden on narrow bars) */}
              <span className={`text-[10px] font-mono uppercase tracking-wider truncate hidden xl:inline ${
                state === 'error' ? 'text-red-400' :
                state === 'pending' ? 'text-muted-foreground/30' : colors.text
              }`}>
                {meta.label}
              </span>
            </div>

            {/* Connector line between stages */}
            {i < PIPELINE_STAGES.length - 1 && (
              <div className={`absolute top-1/2 -right-[3px] w-[5px] h-px z-10 ${
                state === 'completed' ? 'bg-primary/30' : 'bg-primary/10'
              }`} />
            )}

            {/* Hover tooltip */}
            <div className="absolute z-30 bottom-full mb-2 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <div className="bg-background/95 border border-primary/20 rounded-modal px-3 py-2 shadow-elevation-3 backdrop-blur-sm whitespace-nowrap">
                <p className={`typo-heading${state === 'error' ? 'text-red-400' : colors.text}`}>
                  {meta.label}
                </p>
                <p className="typo-body text-muted-foreground/60">{meta.boundary}</p>
                {isActive && boundary && (
                  <p className="typo-code text-muted-foreground/50 mt-0.5">
                    {tx(t.agents.executions.ms_into_stage, { ms: Math.round(currentMs - boundary.startMs) })}
                  </p>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
