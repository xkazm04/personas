import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, RotateCw } from 'lucide-react';
import type { GlobalExecution } from '@/lib/types/types';
import { formatDuration, formatRelativeTime, getStatusEntry } from '@/lib/utils/formatters';
import { ExecutionDetail } from '@/features/agents/sub_executions/ExecutionDetail';

interface ExecutionRowProps {
  execution: GlobalExecution;
  isExpanded: boolean;
  onToggle: () => void;
}

export const ExecutionRow = memo(function ExecutionRow({ execution, isExpanded, onToggle }: ExecutionRowProps) {
  const status = getStatusEntry(execution.status);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      className="rounded-xl border border-primary/15 bg-secondary/20 hover:bg-secondary/30 transition-colors overflow-hidden"
    >
      {/* Main row */}
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer"
      >
        {/* Expand icon */}
        <div className="text-muted-foreground/80">
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </div>

        {/* Persona icon + name */}
        <div className="flex items-center gap-2 w-[140px] sm:w-auto sm:min-w-[140px] flex-shrink-0">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm border border-primary/15"
            style={{ backgroundColor: (execution.persona_color || '#6366f1') + '15' }}
          >
            {execution.persona_icon || '?'}
          </div>
          <span className="text-sm font-medium text-foreground/80 truncate max-w-[100px]">
            {execution.persona_name || 'Unknown'}
          </span>
        </div>

        {/* Status badge */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-sm font-medium border ${status.bg} ${status.text} ${status.border}`}>
          {status.pulse && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
          )}
          {status.label}
        </div>

        {/* Retry badge */}
        {execution.retry_count > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm font-mono rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" title={`Healing retry #${execution.retry_count}`}>
            <RotateCw className="w-2.5 h-2.5" />
            #{execution.retry_count}
          </span>
        )}

        {/* Duration */}
        <span className="text-sm text-muted-foreground/90 min-w-[60px] text-right font-mono">
          {formatDuration(execution.duration_ms)}
        </span>

        {/* Started */}
        <span className="text-sm text-muted-foreground/80 min-w-[70px] text-right">
          {formatRelativeTime(execution.started_at || execution.created_at)}
        </span>

        {/* Error (truncated) */}
        {execution.error_message && (
          <span className="flex-1 text-sm text-red-400/70 truncate ml-2">
            {execution.error_message}
          </span>
        )}
      </div>

      {/* Expanded detail */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-3 border-t border-primary/15">
              <ExecutionDetail execution={execution} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});
