import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { ChevronDown, ChevronRight, RotateCw, Copy, Check, RefreshCw, ArrowLeftRight } from 'lucide-react';
import { formatTimestamp, formatDuration, formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { maskSensitiveJson } from '@/lib/utils/sanitizers/maskSensitive';
import { sanitizeErrorForDisplay } from '@/lib/utils/sanitizers/sanitizeErrorForDisplay';
import { formatTokens } from '../../libs/useExecutionList';
import { CostSparkline } from './ExecutionListItem';

interface ExecutionListRowProps {
  execution: PersonaExecution;
  execIdx: number;
  executions: PersonaExecution[];
  compareMode: boolean;
  compareLeft: string | null;
  compareRight: string | null;
  isExpanded: boolean;
  showRaw: boolean;
  hasCopied: boolean;
  copiedId: string | null;
  onRowClick: (id: string) => void;
  onCopyId: (id: string) => void;
  onRerun: (inputData: string | null) => void;
  onAutoCompareRetry: (id: string) => void;
}

export function ExecutionListRow({
  execution, execIdx, executions, compareMode, compareLeft, compareRight,
  isExpanded, showRaw, hasCopied, copiedId,
  onRowClick, onCopyId, onRerun, onAutoCompareRetry,
}: ExecutionListRowProps) {
  const isCompareSelected = compareLeft === execution.id || compareRight === execution.id;
  const compareLabel = compareLeft === execution.id ? 'A' : compareRight === execution.id ? 'B' : null;
  const chevron = compareMode ? null : isExpanded
    ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
    : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />;
  const statusEntry = getStatusEntry(execution.status);
  const statusBadge = <span className={`px-2 py-0.5 rounded-lg typo-heading ${badgeClass(statusEntry)}`}>{statusEntry.label}</span>;
  const retryBadge = execution.retry_count > 0 ? (
    <Tooltip content={`Healing retry #${execution.retry_count}`}>
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-code rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
        <RefreshCw className="w-2.5 h-2.5" />#{execution.retry_count}
      </span>
    </Tooltip>
  ) : null;
  const duration = <span className="typo-code text-foreground/90">{formatDuration(execution.duration_ms)}</span>;

  return (
    <div>
      {/* Desktop table row (md+) */}
      <div
        onClick={() => onRowClick(execution.id)}
        className={`animate-fade-in hidden md:grid grid-cols-12 gap-4 px-4 py-3 border-b border-primary/10 cursor-pointer transition-colors ${
          isCompareSelected ? 'bg-primary/10 border-l-2 border-l-primary/40' : 'bg-background/30 hover:bg-secondary/20'
        }`}
      >
        {compareMode && (
          <div className="col-span-1 flex items-center">
            {compareLabel ? (
              <span className={`w-5 h-5 rounded-lg flex items-center justify-center typo-heading ${
                compareLabel === 'A' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
              }`}>{compareLabel}</span>
            ) : <span className="w-5 h-5 rounded-lg border border-primary/20 bg-background/30" />}
          </div>
        )}
        <div className={`${compareMode ? 'col-span-2' : 'col-span-2'} flex items-center gap-2`}>{chevron}{statusBadge}{retryBadge}</div>
        <div className="col-span-2 flex items-center">{duration}</div>
        <div className={`${compareMode ? 'col-span-2' : 'col-span-3'} typo-body text-foreground/90 flex items-center`}>{formatTimestamp(execution.started_at)}</div>
        <div className="col-span-2 typo-code text-foreground/90 flex items-center">
          <Tooltip content="Input tokens"><span>{formatTokens(execution.input_tokens)}</span></Tooltip>{' / '}
          <Tooltip content="Output tokens"><span>{formatTokens(execution.output_tokens)}</span></Tooltip>
        </div>
        <div className={`${compareMode ? 'col-span-2' : 'col-span-3'} flex items-center gap-2`}>
          <span className="typo-code text-foreground/90">${execution.cost_usd.toFixed(4)}</span>
          {!compareMode && <CostSparkline costs={executions.slice(execIdx, Math.min(executions.length, execIdx + 10)).map((e) => e.cost_usd).reverse()} />}
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
            }`}>{compareLabel}</span>
          )}
          {chevron}{statusBadge}{retryBadge}{duration}
          <span className="typo-body text-muted-foreground/80 ml-auto">{formatRelativeTime(execution.started_at)}</span>
        </div>
        {execution.error_message && (
          <p className="typo-body text-red-400/70 truncate pl-5.5">{showRaw ? execution.error_message : sanitizeErrorForDisplay(execution.error_message, 'execution-list')}</p>
        )}
      </div>

      {/* Expanded Detail */}
      {isExpanded && (
          <div className="animate-fade-slide-in border-b border-primary/10 bg-secondary/20">
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 2xl:grid-cols-3 gap-4 3xl:gap-5 typo-body">
                <div>
                  <span className="text-muted-foreground/90 typo-code uppercase">Execution ID</span>
                  <Tooltip content={execution.id} placement="bottom">
                    <button onClick={(e) => { e.stopPropagation(); onCopyId(execution.id); }} className="flex items-center gap-1.5 mt-0.5 text-foreground/90 hover:text-foreground/95 transition-colors group">
                      <span className="typo-code">#{execution.id.slice(0, 8)}</span>
                      {hasCopied && copiedId === execution.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />}
                    </button>
                  </Tooltip>
                </div>
                <div><span className="text-muted-foreground/90 typo-code uppercase">Model</span><p className="text-foreground/90 typo-body mt-0.5">{execution.model_used || 'default'}</p></div>
                <div><span className="text-muted-foreground/90 typo-code uppercase">Input Tokens</span><p className="text-foreground/90 typo-code mt-0.5">{execution.input_tokens.toLocaleString()}</p></div>
                <div><span className="text-muted-foreground/90 typo-code uppercase">Output Tokens</span><p className="text-foreground/90 typo-code mt-0.5">{execution.output_tokens.toLocaleString()}</p></div>
                <div><span className="text-muted-foreground/90 typo-code uppercase">Cost</span><p className="text-foreground/90 typo-code mt-0.5">${execution.cost_usd.toFixed(4)}</p></div>
                <div><span className="text-muted-foreground/90 typo-code uppercase">Completed</span><p className="text-foreground/90 typo-body mt-0.5">{formatTimestamp(execution.completed_at)}</p></div>
              </div>
              {execution.input_data && (
                <div>
                  <span className="text-muted-foreground/90 typo-code uppercase">Input Data</span>
                  <pre className="mt-1 p-2 bg-background/50 border border-primary/10 rounded-lg typo-code text-foreground/80 overflow-x-auto">
                    {showRaw ? execution.input_data : maskSensitiveJson(execution.input_data)}
                  </pre>
                </div>
              )}
              {execution.error_message && (
                <div>
                  <span className="text-red-400/70 typo-code uppercase">Error</span>
                  <p className="mt-1 typo-body text-red-400/80">{showRaw ? execution.error_message : sanitizeErrorForDisplay(execution.error_message, 'execution-list')}</p>
                </div>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button onClick={(e) => { e.stopPropagation(); onRerun(execution.input_data); }} className="flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-xl bg-primary/10 text-primary/80 border border-primary/20 hover:bg-primary/20 hover:text-primary transition-colors">
                  <RotateCw className="w-3 h-3" />Re-run with same input
                </button>
                {execution.retry_count > 0 && (
                  <button onClick={(e) => { e.stopPropagation(); void onAutoCompareRetry(execution.id); }} className="flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-xl bg-cyan-500/10 text-cyan-400/80 border border-cyan-500/15 hover:bg-cyan-500/20 hover:text-cyan-400 transition-colors">
                    <ArrowLeftRight className="w-3 h-3" />Compare with original
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
