import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { formatTimestamp, formatDuration, formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { sanitizeErrorForDisplay } from '@/lib/utils/sanitizers/sanitizeErrorForDisplay';
import { CostSparkline } from './comparison/CostSparkline';
import { ExecutionRowExpanded } from './ExecutionRowExpanded';

interface ExecutionListRowProps {
  execution: PersonaExecution;
  execIdx: number;
  executions: PersonaExecution[];
  isExpanded: boolean;
  compareMode: boolean;
  compareLabel: 'A' | 'B' | null;
  isCompareSelected: boolean;
  showRaw: boolean;
  onRowClick: (id: string) => void;
  onRerun: (inputData: string) => void;
  onAutoCompareRetry: (id: string) => void;
}

export function ExecutionListRow({
  execution,
  execIdx,
  executions,
  isExpanded,
  compareMode,
  compareLabel,
  isCompareSelected,
  showRaw,
  onRowClick,
  onRerun,
  onAutoCompareRetry,
}: ExecutionListRowProps) {
  const formatTokens = (tokens: number) => {
    if (tokens === 0) return '-';
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
    return String(tokens);
  };

  const chevron = compareMode ? null : isExpanded ? (
    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
  ) : (
    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
  );

  const statusEntry = getStatusEntry(execution.status);
  const statusBadge = (
    <span className={`px-2 py-0.5 rounded-lg typo-heading ${badgeClass(statusEntry)}`}>
      {statusEntry.label}
    </span>
  );

  const retryBadge = execution.retry_count > 0 ? (
    <Tooltip content={`Healing retry #${execution.retry_count}`}>
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-code rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
        <RefreshCw className="w-2.5 h-2.5" />
        #{execution.retry_count}
      </span>
    </Tooltip>
  ) : null;

  const duration = (
    <span className="typo-code text-foreground/90">
      {formatDuration(execution.duration_ms)}
    </span>
  );

  return (
    <div>
      {/* Desktop table row (md+) */}
      <div
        data-testid={`exec-row-${execution.id}`}
        onClick={() => onRowClick(execution.id)}
        className={`animate-fade-in hidden md:grid grid-cols-12 gap-4 px-4 py-3 border-b border-primary/10 cursor-pointer transition-colors ${
          isCompareSelected
            ? 'bg-primary/10 border-l-2 border-l-primary/40'
            : 'bg-background/30 hover:bg-secondary/20'
        }`}
      >
        {compareMode && (
          <div className="col-span-1 flex items-center">
            {compareLabel ? (
              <span className={`w-5 h-5 rounded-lg flex items-center justify-center typo-heading ${
                compareLabel === 'A' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
              }`}>
                {compareLabel}
              </span>
            ) : (
              <span className="w-5 h-5 rounded-lg border border-primary/20 bg-background/30" />
            )}
          </div>
        )}
        <div className={`${compareMode ? 'col-span-2' : 'col-span-2'} flex items-center gap-2`}>
          {chevron}
          {statusBadge}
          {retryBadge}
        </div>
        <div className="col-span-2 flex items-center">
          {duration}
        </div>
        <div className={`${compareMode ? 'col-span-2' : 'col-span-3'} typo-body text-foreground/90 flex items-center`}>
          {formatTimestamp(execution.started_at)}
        </div>
        <div className="col-span-2 typo-code text-foreground/90 flex items-center">
          <Tooltip content="Input tokens"><span>{formatTokens(execution.input_tokens)}</span></Tooltip>
          {' / '}
          <Tooltip content="Output tokens"><span>{formatTokens(execution.output_tokens)}</span></Tooltip>
        </div>
        <div className={`${compareMode ? 'col-span-2' : 'col-span-3'} flex items-center gap-2`}>
          <span className="typo-code text-foreground/90">
            ${execution.cost_usd.toFixed(4)}
          </span>
          {!compareMode && (
            <CostSparkline
              costs={executions
                .slice(execIdx, Math.min(executions.length, execIdx + 10))
                .map((e) => e.cost_usd)
                .reverse()}
            />
          )}
        </div>
      </div>

      {/* Mobile card (<md) */}
      <div
        onClick={() => onRowClick(execution.id)}
        className={`flex md:hidden flex-col gap-1.5 px-4 py-3 border-b border-primary/10 cursor-pointer transition-colors ${
          isCompareSelected ? 'bg-primary/10' : 'bg-background/30 hover:bg-secondary/20'
        }`}
      >
        <div className="flex items-center gap-2">
          {compareMode && compareLabel && (
            <span className={`w-5 h-5 rounded-lg flex items-center justify-center typo-heading ${
              compareLabel === 'A' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
            }`}>
              {compareLabel}
            </span>
          )}
          {chevron}
          {statusBadge}
          {retryBadge}
          {duration}
          <span className="typo-body text-muted-foreground/80 ml-auto">
            {formatRelativeTime(execution.started_at)}
          </span>
        </div>
        {execution.error_message && (
          <p className="typo-body text-red-400/70 truncate pl-5.5">
            {showRaw ? execution.error_message : sanitizeErrorForDisplay(execution.error_message, 'execution-list-row')}
          </p>
        )}
      </div>

      {/* Expanded Detail */}
      {isExpanded && (
          <div
            className="animate-fade-slide-in border-b border-primary/10 bg-secondary/20"
          >
            <ExecutionRowExpanded
              execution={execution}
              showRaw={showRaw}
              onRerun={onRerun}
              onAutoCompareRetry={onAutoCompareRetry}
            />
          </div>
        )}
    </div>
  );
}
