import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { ChevronDown, ChevronRight, RotateCw, Copy, Check, RefreshCw, ArrowLeftRight, FlaskConical } from 'lucide-react';
import { formatTimestamp, formatDuration, formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { maskSensitiveJson } from '@/lib/utils/sanitizers/maskSensitive';
import { sanitizeErrorForDisplay } from '@/lib/utils/sanitizers/sanitizeErrorForDisplay';
import { formatTokens } from '../../libs/useExecutionList';
import { CostSparkline } from './ExecutionListItem';
import { useTranslation } from '@/i18n/useTranslation';

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
  capabilityTitle: string | null;
  onRowClick: (id: string) => void;
  onCopyId: (id: string) => void;
  onRerun: (inputData: string | null) => void;
  onAutoCompareRetry: (id: string) => void;
}

export function ExecutionListRow({
  execution, execIdx, executions, compareMode, compareLeft, compareRight,
  isExpanded, showRaw, hasCopied, copiedId, capabilityTitle,
  onRowClick, onCopyId, onRerun, onAutoCompareRetry,
}: ExecutionListRowProps) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const isCompareSelected = compareLeft === execution.id || compareRight === execution.id;
  const compareLabel = compareLeft === execution.id ? 'A' : compareRight === execution.id ? 'B' : null;
  const chevron = compareMode ? null : isExpanded
    ? <ChevronDown className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
    : <ChevronRight className="w-3.5 h-3.5 text-foreground flex-shrink-0" />;
  const statusEntry = getStatusEntry(execution.status);
  const statusBadge = <span className={`px-2 py-0.5 rounded-card typo-heading ${badgeClass(statusEntry)}`}>{statusEntry.label}</span>;
  const retryBadge = execution.retry_count > 0 ? (
    <Tooltip content={tx(e.healing_retry, { count: execution.retry_count })}>
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-code rounded-card bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
        <RefreshCw className="w-2.5 h-2.5" />#{execution.retry_count}
      </span>
    </Tooltip>
  ) : null;
  const simulatedBadge = execution.is_simulation ? (
    <Tooltip content={e.simulated_badge_tooltip}>
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 typo-code rounded-card bg-violet-500/10 text-violet-400 border border-violet-500/20">
        <FlaskConical className="w-2.5 h-2.5" />{e.simulated_badge}
      </span>
    </Tooltip>
  ) : null;
  const capabilityCell = (
    <span className="typo-body text-foreground/90 truncate" title={capabilityTitle ?? undefined}>
      {capabilityTitle ?? e.capability_unattributed}
    </span>
  );
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
              <span className={`w-5 h-5 rounded-card flex items-center justify-center typo-heading ${
                compareLabel === 'A' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
              }`}>{compareLabel}</span>
            ) : <span className="w-5 h-5 rounded-card border border-primary/20 bg-background/30" />}
          </div>
        )}
        <div className="col-span-2 flex items-center gap-2 flex-wrap">{chevron}{statusBadge}{retryBadge}{simulatedBadge}</div>
        <div className="col-span-2 flex items-center min-w-0">{capabilityCell}</div>
        <div className={`${compareMode ? 'col-span-1' : 'col-span-2'} flex items-center`}>{duration}</div>
        <div className="col-span-2 typo-body text-foreground/90 flex items-center">{formatTimestamp(execution.started_at)}</div>
        <div className="col-span-2 typo-code text-foreground/90 flex items-center">
          <Tooltip content={e.input_tokens}><span>{formatTokens(execution.input_tokens)}</span></Tooltip>{' / '}
          <Tooltip content={e.output_tokens}><span>{formatTokens(execution.output_tokens)}</span></Tooltip>
        </div>
        <div className={`${compareMode ? 'col-span-1' : 'col-span-2'} flex items-center gap-2`}>
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
        <div className="flex items-center gap-2 flex-wrap">
          {compareMode && compareLabel && (
            <span className={`w-5 h-5 rounded-card flex items-center justify-center typo-heading ${
              compareLabel === 'A' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
            }`}>{compareLabel}</span>
          )}
          {chevron}{statusBadge}{retryBadge}{simulatedBadge}{duration}
          <span className="typo-body text-foreground ml-auto">{formatRelativeTime(execution.started_at)}</span>
        </div>
        {capabilityTitle && (
          <p className="typo-body text-foreground pl-5.5 truncate">{capabilityTitle}</p>
        )}
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
                  <span className="text-foreground typo-code uppercase">{e.execution_id}</span>
                  <Tooltip content={execution.id} placement="bottom">
                    <button onClick={(e) => { e.stopPropagation(); onCopyId(execution.id); }} className="flex items-center gap-1.5 mt-0.5 text-foreground/90 hover:text-foreground/95 transition-colors group">
                      <span className="typo-code">#{execution.id.slice(0, 8)}</span>
                      {hasCopied && copiedId === execution.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />}
                    </button>
                  </Tooltip>
                </div>
                <div><span className="text-foreground typo-code uppercase">{e.model}</span><p className="text-foreground/90 typo-body mt-0.5">{execution.model_used || e.model_default}</p></div>
                <div><span className="text-foreground typo-code uppercase">{e.input_tokens}</span><p className="text-foreground/90 typo-code mt-0.5">{execution.input_tokens.toLocaleString()}</p></div>
                <div><span className="text-foreground typo-code uppercase">{e.output_tokens}</span><p className="text-foreground/90 typo-code mt-0.5">{execution.output_tokens.toLocaleString()}</p></div>
                <div><span className="text-foreground typo-code uppercase">{e.cost}</span><p className="text-foreground/90 typo-code mt-0.5">${execution.cost_usd.toFixed(4)}</p></div>
                <div><span className="text-foreground typo-code uppercase">{e.completed}</span><p className="text-foreground/90 typo-body mt-0.5">{formatTimestamp(execution.completed_at)}</p></div>
              </div>
              {execution.input_data && (
                <div>
                  <span className="text-foreground typo-code uppercase">{e.input_data}</span>
                  <pre className="mt-1 p-2 bg-background/50 border border-primary/10 rounded-card typo-code text-foreground overflow-x-auto">
                    {showRaw ? execution.input_data : maskSensitiveJson(execution.input_data)}
                  </pre>
                </div>
              )}
              {execution.error_message && (
                <div>
                  <span className="text-red-400/70 typo-code uppercase">{e.error}</span>
                  <p className="mt-1 typo-body text-red-400/80">{showRaw ? execution.error_message : sanitizeErrorForDisplay(execution.error_message, 'execution-list')}</p>
                </div>
              )}
              <div className="flex items-center gap-2 pt-1">
                <button onClick={(e) => { e.stopPropagation(); onRerun(execution.input_data); }} className="flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-modal bg-primary/10 text-primary/80 border border-primary/20 hover:bg-primary/20 hover:text-primary transition-colors">
                  <RotateCw className="w-3 h-3" />{e.rerun_with_same_input}
                </button>
                {execution.retry_count > 0 && (
                  <button onClick={(e) => { e.stopPropagation(); void onAutoCompareRetry(execution.id); }} className="flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-modal bg-cyan-500/10 text-cyan-400/80 border border-cyan-500/15 hover:bg-cyan-500/20 hover:text-cyan-400 transition-colors">
                    <ArrowLeftRight className="w-3 h-3" />{e.compare_with_original}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
