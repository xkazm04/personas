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
  const completedStages = useMemo(() => {
    if (!trace) return new Set<PipelineStage>();
    return new Set(
      trace.spans
        .filter((s) => isPipelineStage(s.span_type))
        .map((s) => s.span_type as PipelineStage),
    );
  }, [trace]);

  const errorStages = useMemo(() => {
    if (!trace) return new Set<PipelineStage>();
    return new Set(
      trace.spans
        .filter((s) => isPipelineStage(s.span_type) && s.error)
        .map((s) => s.span_type as PipelineStage),
    );
  }, [trace]);

  return (
    <div className="flex items-center gap-1">
      {PIPELINE_STAGES.map((stage) => {
        const completed = completedStages.has(stage);
        const hasError = errorStages.has(stage);
        const pStages = trace?.spans.filter((s) => isPipelineStage(s.span_type)) ?? [];
        const lastStage = pStages[pStages.length - 1];
        const isLast =
          trace &&
          lastStage &&
          lastStage.span_type === stage &&
          !trace.completedAt;

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
