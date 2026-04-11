import type { PersonaExecution } from '@/lib/types/types';
import type { PipelineTrace } from '@/lib/execution/pipeline';
import { PIPELINE_STAGES } from '@/lib/execution/pipeline';
import { Clock, DollarSign, Zap, AlertCircle } from 'lucide-react';
import { formatDuration } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Summary row
// ---------------------------------------------------------------------------

export function PipelineSummary({ trace, execution }: { trace: PipelineTrace; execution: PersonaExecution }) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const totalMs = trace.completedAt ? trace.completedAt - trace.startedAt : 0;
  const stagesHit = trace.spans.length;
  const errors = trace.spans.filter(e => e.error).length;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <div className="rounded-lg border border-primary/20 bg-secondary/40 p-3 space-y-1">
        <div className="typo-code text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" /> {e.total_duration}
        </div>
        <div className="typo-code text-foreground/90">{formatDuration(totalMs)}</div>
      </div>
      <div className="rounded-lg border border-primary/20 bg-secondary/40 p-3 space-y-1">
        <div className="typo-code text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <DollarSign className="w-2.5 h-2.5" /> {e.cost}
        </div>
        <div className="typo-code text-foreground/90">
          {execution.cost_usd > 0 ? `$${execution.cost_usd.toFixed(4)}` : '-'}
        </div>
      </div>
      <div className="rounded-lg border border-primary/20 bg-secondary/40 p-3 space-y-1">
        <div className="typo-code text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <Zap className="w-2.5 h-2.5" /> {e.stages}
        </div>
        <div className="typo-code text-foreground/90">{stagesHit} / {PIPELINE_STAGES.length}</div>
      </div>
      <div className="rounded-lg border border-primary/20 bg-secondary/40 p-3 space-y-1">
        <div className="typo-code text-muted-foreground/70 uppercase tracking-wider flex items-center gap-1">
          <AlertCircle className="w-2.5 h-2.5" /> {e.errors}
        </div>
        <div className={`typo-code ${errors > 0 ? 'text-red-400' : 'text-foreground/90'}`}>{errors}</div>
      </div>
    </div>
  );
}
