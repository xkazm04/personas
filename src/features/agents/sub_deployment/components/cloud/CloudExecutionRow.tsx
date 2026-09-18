import { useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { ChevronDown, ChevronRight, Terminal, RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { statusIcon, classifyExecutionStatus, formatDuration, formatCost, timeAgo } from './CloudHistoryHelpers';
import type { CloudExecution } from '@/api/system/cloud';

interface CloudExecutionRowProps {
  exec: CloudExecution;
  personaName: string;
  isExpanded: boolean;
  onToggle: () => void;
  output?: { lines: string[]; loading: boolean; error?: string };
  /** First read: served from the panel's cache when it has one. */
  onFetchOutput: () => void;
  /** Explicit re-read past the cache - the only honest meaning of a refresh control. */
  onRefreshOutput?: () => void;
}

export function CloudExecutionRow({ exec, personaName, isExpanded, onToggle, output, onFetchOutput, onRefreshOutput }: CloudExecutionRowProps) {
  const { t } = useTranslation();
  const dt = t.deployment.exec_detail;
  const statusClass = classifyExecutionStatus(exec.status);

  // Red opens to the failure: expanding a failed run loads its output at once
  // instead of parking a "View Output" button behind one more click. The
  // registry's failure-drill-down technique calls this the zero-click triage
  // posture; the extra read is paid only for failed rows the user opened.
  // The callback rides in a ref so a parent re-render never re-arms the effect.
  const fetchRef = useRef(onFetchOutput);
  fetchRef.current = onFetchOutput;
  useEffect(() => {
    if (isExpanded && statusClass === 'failed' && !output) fetchRef.current();
  }, [isExpanded, statusClass, output]);
  return (
    <div data-testid="cloud-execution-row" className="rounded-card bg-secondary/30 border border-primary/10 overflow-hidden">
      {/* Row */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-secondary/50 transition-colors cursor-pointer"
      >
        {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-foreground" />}
        {statusIcon(exec.status)}
        <span className="typo-body text-foreground truncate flex-1">{personaName}</span>
        <span className="typo-caption text-foreground">{formatDuration(Number(exec.durationMs))}</span>
        <span className="typo-caption text-foreground">{formatCost(exec.costUsd)}</span>
        <span className="typo-caption text-foreground">{timeAgo(exec.createdAt)}</span>
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-primary/10 space-y-2">
          <div className="grid grid-cols-2 gap-2 typo-caption">
            <div><span className="text-foreground">{dt.label_status}</span> <span className="text-foreground">{exec.status}</span></div>
            <div><span className="text-foreground">{dt.label_duration}</span> <span className="text-foreground">{formatDuration(Number(exec.durationMs))}</span></div>
            <div><span className="text-foreground">{dt.label_cost}</span> <span className="text-foreground">{formatCost(exec.costUsd)}</span></div>
            <div><span className="text-foreground">{dt.label_tokens}</span> <span className="text-foreground">{Number(exec.inputTokens ?? 0) + Number(exec.outputTokens ?? 0)}</span></div>
            <div><span className="text-foreground">{dt.label_started}</span> <span className="text-foreground"><AbsoluteTime timestamp={exec.startedAt} /></span></div>
            <div><span className="text-foreground">{dt.label_completed}</span> <span className="text-foreground"><AbsoluteTime timestamp={exec.completedAt} /></span></div>
          </div>
          {exec.errorMessage && (
            <div className="p-2 rounded-card bg-red-500/5 border border-red-500/10 typo-caption text-red-400">
              {exec.errorMessage}
            </div>
          )}
          {exec.inputData && (
            <div className="space-y-1">
              <span className="typo-caption text-foreground">{dt.label_input}</span>
              <pre className="typo-caption text-foreground bg-secondary/40 p-2 rounded-card overflow-auto max-h-32 border border-primary/10">
                {exec.inputData}
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
                  className="flex items-center gap-1.5 px-2.5 py-1 typo-caption font-medium rounded-card bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 hover:bg-indigo-500/20 hover:border-indigo-500/30 transition-colors cursor-pointer"
                >
                  <Terminal className="w-3 h-3" />
                  {dt.view_output}
                </button>
              );
            }
            if (output.loading) {
              return (
                <div className="flex items-center gap-2 typo-caption text-foreground">
                  <LoadingSpinner size="sm" /> {dt.fetching_output}
                </div>
              );
            }
            if (output.error) {
              return (
                <div className="p-2 rounded-card bg-red-500/5 border border-red-500/10 typo-caption text-red-400">
                  {output.error}
                </div>
              );
            }
            if (output.lines.length === 0) {
              return (
                <p className="typo-caption text-foreground italic">{dt.no_output}</p>
              );
            }
            return (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="typo-caption text-foreground flex items-center gap-1">
                    <Terminal className="w-3 h-3" /> {dt.output_prefix}{output.lines.length} {dt.output_lines_suffix}
                  </span>
                  <button
                    type="button"
                    onClick={onRefreshOutput ?? onFetchOutput}
                    aria-label={t.common.refresh}
                    data-testid={`cloud-exec-output-refresh-${exec.id}`}
                    className="typo-caption text-foreground hover:text-foreground/70 transition-colors cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>
                <pre className="typo-code text-emerald-300/80 bg-gray-950/60 p-3 rounded-card overflow-auto max-h-64 border border-primary/10 font-mono leading-relaxed">
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
