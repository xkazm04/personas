import { useTranslation } from '@/i18n/useTranslation';
import { ChevronDown, ChevronRight, Terminal, RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { statusIcon, formatDuration, formatCost, timeAgo } from './CloudHistoryHelpers';
import type { CloudExecution } from '@/api/system/cloud';

interface CloudExecutionRowProps {
  exec: CloudExecution;
  personaName: string;
  isExpanded: boolean;
  onToggle: () => void;
  output?: { lines: string[]; loading: boolean; error?: string };
  onFetchOutput: () => void;
}

export function CloudExecutionRow({ exec, personaName, isExpanded, onToggle, output, onFetchOutput }: CloudExecutionRowProps) {
  const { t } = useTranslation();
  const dt = t.deployment.exec_detail;
  return (
    <div className="rounded-card bg-secondary/30 border border-primary/10 overflow-hidden">
      {/* Row */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-secondary/50 transition-colors cursor-pointer"
      >
        {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-foreground" />}
        {statusIcon(exec.status)}
        <span className="text-sm text-foreground truncate flex-1">{personaName}</span>
        <span className="text-xs text-foreground">{formatDuration(exec.duration_ms)}</span>
        <span className="text-xs text-foreground">{formatCost(exec.cost_usd)}</span>
        <span className="text-xs text-foreground">{timeAgo(exec.created_at)}</span>
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-primary/10 space-y-2">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span className="text-foreground">Status:</span> <span className="text-foreground">{exec.status}</span></div>
            <div><span className="text-foreground">Duration:</span> <span className="text-foreground">{formatDuration(exec.duration_ms)}</span></div>
            <div><span className="text-foreground">Cost:</span> <span className="text-foreground">{formatCost(exec.cost_usd)}</span></div>
            <div><span className="text-foreground">Tokens:</span> <span className="text-foreground">{(exec.input_tokens ?? 0) + (exec.output_tokens ?? 0)}</span></div>
            <div><span className="text-foreground">Started:</span> <span className="text-foreground">{exec.started_at ? new Date(exec.started_at).toLocaleString() : '-'}</span></div>
            <div><span className="text-foreground">Completed:</span> <span className="text-foreground">{exec.completed_at ? new Date(exec.completed_at).toLocaleString() : '-'}</span></div>
          </div>
          {exec.error_message && (
            <div className="p-2 rounded-card bg-red-500/5 border border-red-500/10 text-xs text-red-400">
              {exec.error_message}
            </div>
          )}
          {exec.input_data && (
            <div className="space-y-1">
              <span className="text-xs text-foreground">Input:</span>
              <pre className="text-xs text-foreground bg-secondary/40 p-2 rounded-card overflow-auto max-h-32 border border-primary/10">
                {exec.input_data}
              </pre>
            </div>
          )}

          {/* Execution output viewer */}
          {(() => {
            if (!output) {
              return (
                <button
                  type="button"
                  onClick={onFetchOutput}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-card bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 hover:border-indigo-500/30 transition-colors cursor-pointer"
                >
                  <Terminal className="w-3 h-3" />
                  View Output
                </button>
              );
            }
            if (output.loading) {
              return (
                <div className="flex items-center gap-2 text-xs text-foreground">
                  <LoadingSpinner size="sm" /> {dt.fetching_output}
                </div>
              );
            }
            if (output.error) {
              return (
                <div className="p-2 rounded-card bg-red-500/5 border border-red-500/10 text-xs text-red-400">
                  {output.error}
                </div>
              );
            }
            if (output.lines.length === 0) {
              return (
                <p className="text-xs text-foreground italic">{dt.no_output}</p>
              );
            }
            return (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-foreground flex items-center gap-1">
                    <Terminal className="w-3 h-3" /> Output ({output.lines.length} lines)
                  </span>
                  <button
                    type="button"
                    onClick={onFetchOutput}
                    className="text-xs text-foreground hover:text-foreground/70 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>
                <pre className="text-xs text-emerald-300/80 bg-gray-950/60 p-3 rounded-card overflow-auto max-h-64 border border-primary/10 font-mono leading-relaxed">
                  {output.lines.join('\n')}
                </pre>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
