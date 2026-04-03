import { memo } from 'react';
import { ChevronDown, ChevronRight, RotateCw } from 'lucide-react';
import type { GlobalExecution } from '@/lib/types/types';
import { formatDuration, getStatusEntry } from '@/lib/utils/formatters';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { ExecutionDetail } from '@/features/agents/sub_executions';

interface ExecutionRowProps {
  execution: GlobalExecution;
  isExpanded: boolean;
  onToggle: () => void;
}

export const ExecutionRow = memo(function ExecutionRow({ execution, isExpanded, onToggle }: ExecutionRowProps) {
  const status = getStatusEntry(execution.status);

  return (
    <div
      className="animate-fade-slide-in rounded-xl border border-primary/15 bg-secondary/20 hover:bg-secondary/30 transition-colors overflow-hidden"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer"
      >
        <div className="text-muted-foreground/80">
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </div>

        <div className="flex items-center gap-2 w-[140px] sm:w-auto sm:min-w-[140px] flex-shrink-0">
          <PersonaIcon icon={execution.persona_icon ?? null} color={execution.persona_color ?? null} display="framed" frameSize={"lg"} />
          <span className="typo-heading text-foreground/80 truncate max-w-[100px]">
            {execution.persona_name || 'Unknown'}
          </span>
        </div>

        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl typo-heading border ${status.bg} ${status.text} ${status.border}`}>
          {status.pulse && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
          )}
          {status.label}
        </div>

        {execution.retry_count > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" title={`Healing retry #${execution.retry_count}`}>
            <RotateCw className="w-2.5 h-2.5" />
            #{execution.retry_count}
          </span>
        )}

        <span className="text-sm text-muted-foreground/90 min-w-[60px] text-right font-mono">
          {formatDuration(execution.duration_ms)}
        </span>

        <RelativeTime timestamp={execution.started_at || execution.created_at} className="text-sm text-muted-foreground/80 min-w-[70px] text-right" />

        {execution.error_message && (
          <span className="flex-1 text-sm text-red-400/70 truncate ml-2">
            {execution.error_message}
          </span>
        )}
      </div>

      {isExpanded && (
        <div
          className="animate-fade-slide-in overflow-hidden"
        >
          <div className="px-4 pb-4 pt-3 border-t border-primary/15">
            <ExecutionDetail execution={execution} />
          </div>
        </div>
      )}
    </div>
  );
});
