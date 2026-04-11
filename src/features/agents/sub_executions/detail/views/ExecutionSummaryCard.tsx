import { Timer, DollarSign, Wrench, RotateCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { getStatusEntry } from '@/lib/utils/formatters';
import { StatusIcon } from '../../runnerTypes';

interface ExecutionSummaryCardProps {
  executionSummary: {
    status: string;
    duration_ms?: number | null;
    cost_usd?: number | null;
    last_tool?: string | null;
  };
  onResume: () => void;
}

export function ExecutionSummaryCard({ executionSummary, onResume }: ExecutionSummaryCardProps) {
  const { t } = useTranslation();
  const summaryPresentation = getStatusEntry(executionSummary.status);

  return (
    <div
      className={`animate-fade-slide-in rounded-xl border p-4 ${summaryPresentation.border} ${summaryPresentation.bg}`}
    >
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <StatusIcon status={executionSummary.status} className="w-5 h-5" />
          <span className={`typo-heading capitalize ${summaryPresentation.text}`}>
            {executionSummary.status}
          </span>
        </div>

        {executionSummary.duration_ms != null && (
          <div className="flex items-center gap-1.5 text-muted-foreground/80">
            <Timer className="w-3.5 h-3.5" />
            <span className="typo-code">{(executionSummary.duration_ms / 1000).toFixed(1)}s</span>
          </div>
        )}

        {executionSummary.cost_usd != null && (
          <div className="flex items-center gap-1.5 text-muted-foreground/80">
            <DollarSign className="w-3.5 h-3.5" />
            <span className="typo-code">${executionSummary.cost_usd.toFixed(4)}</span>
          </div>
        )}
      </div>

      {/* Cancelled-specific: last tool + resume */}
      {executionSummary.status === 'cancelled' && (
        <div className="mt-3 pt-3 border-t border-amber-500/15 space-y-3">
          {executionSummary.last_tool && (
            <div className="flex items-center gap-2 typo-body text-muted-foreground/90">
              <Wrench className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0" />
              <span>{t.agents.executions.stopped_while_running}</span>
              <code className="px-1.5 py-0.5 rounded-lg bg-amber-500/10 text-amber-300/80 typo-code">
                {executionSummary.last_tool}
              </code>
            </div>
          )}
          <button
            onClick={onResume}
            className="flex items-center gap-2 px-3.5 py-2 typo-heading rounded-xl bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 hover:text-amber-200 transition-colors"
          >
            <RotateCw className="w-3.5 h-3.5" />
            {t.agents.executions.resume_from_here}
          </button>
        </div>
      )}
    </div>
  );
}
