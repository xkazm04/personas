import { ReactNode } from 'react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { formatTimestamp, formatDuration, formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { sanitizeErrorMessage } from '@/lib/utils/sanitizers/maskSensitive';
import { CostSparkline } from './CostSparkline';
import { ExecutionExpandedDetail } from './ExecutionExpandedDetail';

interface ExecutionRowProps {
  execution: PersonaExecution;
  execIdx: number;
  executions: PersonaExecution[];
  compareMode: boolean;
  compareLeft: string | null;
  compareRight: string | null;
  expandedId: string | null;
  showRaw: boolean;
  hasCopied: boolean;
  copiedId: string | null;
  formatTokens: (tokens: number) => string;
  handleRowClick: (executionId: string) => void;
  copyToClipboard: (text: string) => void;
  setCopiedId: (id: string | null) => void;
  setRerunInputData: (data: string) => void;
  handleAutoCompareRetry: (executionId: string) => void;
}

export function ExecutionRow({
  execution,
  execIdx,
  executions,
  compareMode,
  compareLeft,
  compareRight,
  expandedId,
  showRaw,
  hasCopied,
  copiedId,
  formatTokens,
  handleRowClick,
  copyToClipboard,
  setCopiedId,
  setRerunInputData,
  handleAutoCompareRetry,
}: ExecutionRowProps) {
  const isExpanded = expandedId === execution.id && !compareMode;
  const isCompareSelected = compareLeft === execution.id || compareRight === execution.id;
  const compareLabel = compareLeft === execution.id ? 'A' : compareRight === execution.id ? 'B' : null;

  const chevron = compareMode ? null : isExpanded ? (
    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
  ) : (
    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/80 flex-shrink-0" />
  );

  const statusEntry = getStatusEntry(execution.status);
  const statusBadge = (
    <span className={`px-2 py-0.5 rounded-lg text-sm font-medium ${badgeClass(statusEntry)}`}>
      {statusEntry.label}
    </span>
  );

  const retryBadge = execution.retry_count > 0 ? (
    <Tooltip content={`Healing retry #${execution.retry_count}`}>
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
        <RefreshCw className="w-2.5 h-2.5" />
        #{execution.retry_count}
      </span>
    </Tooltip>
  ) : null;

  const duration = (
    <span className="text-sm text-foreground/90 font-mono">
      {formatDuration(execution.duration_ms)}
    </span>
  );

  const compareLabelBadge: ReactNode = compareLabel ? (
    <span className={`w-5 h-5 rounded-lg flex items-center justify-center text-sm font-bold ${
      compareLabel === 'A' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
    }`}>
      {compareLabel}
    </span>
  ) : (
    <span className="w-5 h-5 rounded-lg border border-primary/15 bg-background/30" />
  );

  return (
    <div key={execution.id}>
      {/* Desktop table row (md+) */}
      <motion.div
        onClick={() => handleRowClick(execution.id)}
        className={`hidden md:grid grid-cols-12 gap-4 px-4 py-3 border-b border-primary/10 cursor-pointer transition-colors ${
          isCompareSelected
            ? 'bg-primary/10 border-l-2 border-l-primary/40'
            : 'bg-background/30 hover:bg-secondary/20'
        }`}
      >
        {compareMode && (
          <div className="col-span-1 flex items-center">
            {compareLabelBadge}
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
        <div className={`${compareMode ? 'col-span-2' : 'col-span-3'} text-sm text-foreground/90 flex items-center`}>
          {formatTimestamp(execution.started_at)}
        </div>
        <div className="col-span-2 text-sm text-foreground/90 font-mono flex items-center">
          <Tooltip content="Input tokens"><span>{formatTokens(execution.input_tokens)}</span></Tooltip>
          {' / '}
          <Tooltip content="Output tokens"><span>{formatTokens(execution.output_tokens)}</span></Tooltip>
        </div>
        <div className={`${compareMode ? 'col-span-2' : 'col-span-3'} flex items-center gap-2`}>
          <span className="text-sm text-foreground/90 font-mono">
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
      </motion.div>

      {/* Mobile card layout (<md) */}
      <div
        onClick={() => handleRowClick(execution.id)}
        className={`flex md:hidden flex-col gap-1.5 px-4 py-3 border-b border-primary/10 cursor-pointer transition-colors ${
          isCompareSelected ? 'bg-primary/10' : 'bg-background/30 hover:bg-secondary/20'
        }`}
      >
        <div className="flex items-center gap-2">
          {compareMode && compareLabel && (
            <span className={`w-5 h-5 rounded-lg flex items-center justify-center text-sm font-bold ${
              compareLabel === 'A' ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30' : 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
            }`}>
              {compareLabel}
            </span>
          )}
          {chevron}
          {statusBadge}
          {retryBadge}
          {duration}
          <span className="text-sm text-muted-foreground/80 ml-auto">
            {formatRelativeTime(execution.started_at)}
          </span>
        </div>
        {execution.error_message && (
          <p className="text-sm text-red-400/70 truncate pl-5.5">
            {showRaw ? execution.error_message : sanitizeErrorMessage(execution.error_message)}
          </p>
        )}
      </div>

      {/* Expanded Detail */}
      <ExecutionExpandedDetail
        execution={execution}
        isExpanded={isExpanded}
        showRaw={showRaw}
        hasCopied={hasCopied}
        copiedId={copiedId}
        copyToClipboard={copyToClipboard}
        setCopiedId={setCopiedId}
        setRerunInputData={setRerunInputData}
        handleAutoCompareRetry={handleAutoCompareRetry}
      />
    </div>
  );
}
