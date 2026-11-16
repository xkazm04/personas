import { useMemo } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { LiveStatusDot } from '@/features/shared/components/display/LiveStatusDot';
import {
  PIPELINE_STAGES,
  STAGE_META,
  isPipelineStage,
  type PipelineStage,
  type UnifiedTrace,
} from '@/lib/execution/pipeline';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

export function PipelineDots({ trace }: { trace: UnifiedTrace | null }) {
  const { stages, errors, lastStage } = useMemo(() => {
    const s = new Set<PipelineStage>();
    const e = new Set<PipelineStage>();
    let last: PipelineStage | null = null;
    if (trace) {
      for (const span of trace.spans) {
        if (!isPipelineStage(span.span_type)) continue;
        const ps = span.span_type as PipelineStage;
        s.add(ps);
        if (span.error) e.add(ps);
        last = ps;
      }
    }
    return { stages: s, errors: e, lastStage: last };
  }, [trace]);

  return (
    <div className="flex items-center gap-1">
      {PIPELINE_STAGES.map((stage) => {
        const completed = stages.has(stage);
        const hasError = errors.has(stage);
        const isLast = lastStage === stage && trace && !trace.completedAt;

        return (
          <Tooltip key={stage} content={STAGE_META[stage].label} placement="bottom">
            <div
              className={`w-2 h-2 rounded-full transition-colors ${
                hasError
                  ? 'bg-status-error'
                  : isLast
                    ? 'bg-status-info animate-pulse'
                    : completed
                      ? 'bg-status-success'
                      : 'bg-primary/15'
              }`}
            />
          </Tooltip>
        );
      })}
    </div>
  );
}

export function StatusIndicator({ isExecuting, hasError }: { isExecuting: boolean; hasError: boolean }) {
  if (hasError) return <XCircle className="w-4 h-4 text-status-error" />;
  // LoadingSpinner renders null, so the header showed NO glyph while a run was
  // in flight. The shared liveness dot is the app's vocabulary for "in flight"
  // (CloudHistoryHelpers uses the same swap for queued/running rows).
  if (isExecuting) return <LiveStatusDot tone="syncing" size="sm" className="mx-1" />;
  return <CheckCircle2 className="w-4 h-4 text-status-success" />;
}
