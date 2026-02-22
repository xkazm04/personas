import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Copy, Check, RotateCw } from 'lucide-react';
import type { GlobalExecution } from '@/lib/types/types';
import type { PersonaExecutionStatus } from '@/lib/types/frontendTypes';
import { formatDuration, formatRelativeTime } from '@/lib/utils/formatters';
import { useCopyToClipboard } from '@/hooks/utility/useCopyToClipboard';

const statusConfig: Record<PersonaExecutionStatus, { label: string; color: string; bgColor: string; borderColor: string; pulse?: boolean }> = {
  pending: { label: 'Pending', color: 'text-muted-foreground', bgColor: 'bg-muted/30', borderColor: 'border-muted-foreground/20' },
  running: { label: 'Running', color: 'text-blue-400', bgColor: 'bg-blue-500/10', borderColor: 'border-blue-500/30', pulse: true },
  completed: { label: 'Completed', color: 'text-emerald-400', bgColor: 'bg-emerald-500/10', borderColor: 'border-emerald-500/30' },
  failed: { label: 'Failed', color: 'text-red-400', bgColor: 'bg-red-500/10', borderColor: 'border-red-500/30' },
  cancelled: { label: 'Cancelled', color: 'text-amber-400', bgColor: 'bg-amber-500/10', borderColor: 'border-amber-500/30' },
};

interface ExecutionRowProps {
  execution: GlobalExecution;
  isExpanded: boolean;
  onToggle: () => void;
}

export function ExecutionRow({ execution, isExpanded, onToggle }: ExecutionRowProps) {
  const status = statusConfig[execution.status as PersonaExecutionStatus] || statusConfig.pending;
  const { copied: hasCopied, copy } = useCopyToClipboard();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const copyToClipboard = (value: string, field: string) => {
    copy(value);
    setCopiedField(field);
  };

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
        <div className="text-muted-foreground/40">
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </div>

        {/* Persona icon + name */}
        <div className="flex items-center gap-2 min-w-[140px]">
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
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border ${status.bgColor} ${status.color} ${status.borderColor}`}>
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
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20" title={`Healing retry #${execution.retry_count}`}>
            <RotateCw className="w-2.5 h-2.5" />
            #{execution.retry_count}
          </span>
        )}

        {/* Duration */}
        <span className="text-xs text-muted-foreground/50 min-w-[60px] text-right font-mono">
          {formatDuration(execution.duration_ms)}
        </span>

        {/* Started */}
        <span className="text-xs text-muted-foreground/40 min-w-[70px] text-right">
          {formatRelativeTime(execution.started_at || execution.created_at)}
        </span>

        {/* Error (truncated) */}
        {execution.error_message && (
          <span className="flex-1 text-xs text-red-400/70 truncate ml-2">
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
            <div className="px-4 pb-4 pt-1 border-t border-primary/15 space-y-3">
              {/* Output */}
              {execution.output_data && (
                <div>
                  <div className="text-[11px] font-mono text-muted-foreground/50 uppercase mb-1.5">Output</div>
                  <pre className="text-xs text-foreground/70 bg-background/50 border border-primary/10 rounded-lg p-3 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono">
                    {execution.output_data}
                  </pre>
                </div>
              )}

              {/* Error */}
              {execution.error_message && (
                <div>
                  <div className="text-[11px] font-mono text-red-400/50 uppercase mb-1.5">Error</div>
                  <pre className="text-xs text-red-400/80 bg-red-500/5 border border-red-500/10 rounded-lg p-3 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono">
                    {execution.error_message}
                  </pre>
                </div>
              )}

              {/* Metadata */}
              <div className="flex items-center gap-4 text-[11px] text-muted-foreground/40">
                <button
                  onClick={(e) => { e.stopPropagation(); copyToClipboard(execution.id, 'id'); }}
                  className="inline-flex items-center gap-1 hover:text-muted-foreground/70 transition-colors group"
                  title={execution.id}
                >
                  ID: <span className="font-mono">#{execution.id.slice(0, 8)}</span>
                  {hasCopied && copiedField === 'id' ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                  )}
                </button>
                {execution.claude_session_id && (
                  <button
                    onClick={(e) => { e.stopPropagation(); copyToClipboard(execution.claude_session_id!, 'session'); }}
                    className="inline-flex items-center gap-1 hover:text-muted-foreground/70 transition-colors group"
                    title={execution.claude_session_id}
                  >
                    Session: <span className="font-mono">#{execution.claude_session_id.slice(0, 8)}</span>
                    {hasCopied && copiedField === 'session' ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                    )}
                  </button>
                )}
                {execution.started_at && (
                  <span>Started: {new Date(execution.started_at).toLocaleString()}</span>
                )}
                {execution.completed_at && (
                  <span>Completed: {new Date(execution.completed_at).toLocaleString()}</span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
