import type { PersonaExecution } from '@/lib/types/types';
import type { UnifiedTrace } from '@/lib/execution/pipeline';
import { PIPELINE_STAGES } from '@/lib/execution/pipeline';
import { Clock, DollarSign, Zap, AlertCircle } from 'lucide-react';
import { formatDuration } from '@/lib/utils/formatters';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Summary row
// ---------------------------------------------------------------------------

export function PipelineSummary({ trace, execution }: { trace: UnifiedTrace; execution: PersonaExecution }) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const totalMs = trace.completedAt ? trace.completedAt - trace.startedAt : 0;
  const stagesHit = trace.spans.length;
  const errors = trace.spans.filter(e => e.error).length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="rounded-card border border-hair bg-surface-2 p-3 space-y-1">
        <div className="typo-eyebrow text-ink-1 flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" /> {e.total_duration}
        </div>
        <div className="typo-code text-ink-1">{formatDuration(totalMs)}</div>
      </div>
      <div className="rounded-card border border-hair bg-surface-2 p-3 space-y-1">
        <div className="typo-eyebrow text-ink-1 flex items-center gap-1">
          <DollarSign className="w-2.5 h-2.5" /> {e.cost}
        </div>
        <div className="typo-code text-ink-1">
          {execution.cost_usd != null && execution.cost_usd > 0 ? <>$<Numeric value={execution.cost_usd} precision={4} /></> : '-'}
        </div>
      </div>
      <div className="rounded-card border border-hair bg-surface-2 p-3 space-y-1">
        <div className="typo-eyebrow text-ink-1 flex items-center gap-1">
          <Zap className="w-2.5 h-2.5" /> {e.stages}
        </div>
        <div className="typo-code text-ink-1">{stagesHit} / {PIPELINE_STAGES.length}</div>
      </div>
      <div className="rounded-card border border-hair bg-surface-2 p-3 space-y-1">
        <div className="typo-eyebrow text-ink-1 flex items-center gap-1">
          <AlertCircle className="w-2.5 h-2.5" /> {e.errors}
        </div>
        <div className={`typo-code ${errors > 0 ? 'text-status-error' : 'text-ink-1'}`}>{errors}</div>
      </div>
    </div>
  );
}
