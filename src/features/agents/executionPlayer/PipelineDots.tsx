import { useMemo } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
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
          <Tooltip content={STAGE_META[stage].label} placement="bottom">
            <div
              key={stage}
              className={`w-2 h-2 rounded-full transition-colors ${
                hasError
                  ? 'bg-red-400'
                  : isLast
                    ? 'bg-blue-400 animate-pulse'
                    : completed
                      ? 'bg-emerald-400'
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
  if (hasError) return <XCircle className="w-4 h-4 text-red-400" />;
  if (isExecuting) return <LoadingSpinner className="text-blue-400" />;
  return <CheckCircle2 className="w-4 h-4 text-emerald-400" />;
}
