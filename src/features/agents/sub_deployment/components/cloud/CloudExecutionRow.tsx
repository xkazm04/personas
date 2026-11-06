import { useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { ChevronDown, ChevronRight, Terminal, RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { statusIcon, classifyExecutionStatus, formatDuration, formatCost, timeAgo } from './CloudHistoryHelpers';
import type { CloudExecution } from '@/api/system/cloud';
import Button from '@/features/shared/components/buttons/Button';

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
  // An unreported figure is unknown, not zero: Number(null) is 0, which
  // painted a running or unmetered run as "0ms" and 0 tokens. formatDuration
  // already renders null as an em dash (as CloudHistoryPanel's stat does).
  const durationMs = exec.durationMs == null ? null : Number(exec.durationMs);
  const tokens = exec.inputTokens == null && exec.outputTokens == null
    ? null
    : Number(exec.inputTokens ?? 0) + Number(exec.outputTokens ?? 0);

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
    <div data-testid="cloud-execution-row" className="rounded-card bg-surface-1 border border-hair overflow-hidden">
      {/* Row */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-surface-2 transition-colors cursor-pointer"
      >
        {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-ink-1" /> : <ChevronRight className="w-3.5 h-3.5 text-ink-1" />}
        {statusIcon(exec.status)}
        <span className="typo-body text-ink-1 truncate flex-1">{personaName}</span>
        <span className="typo-caption text-ink-2">{formatDuration(durationMs)}</span>
        <span className="typo-caption text-ink-2">{formatCost(exec.costUsd)}</span>
        <span className="typo-caption text-ink-2">{timeAgo(exec.createdAt)}</span>
      </button>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-hair space-y-2">
          <div className="grid grid-cols-2 gap-2 typo-caption">
            <div><span className="text-ink-1">{dt.label_status}</span> <span className="text-ink-1">{tokenLabel(t, 'execution', exec.status)}</span></div>
            <div><span className="text-ink-1">{dt.label_duration}</span> <span className="text-ink-1">{formatDuration(durationMs)}</span></div>
            <div><span className="text-ink-1">{dt.label_cost}</span> <span className="text-ink-1">{formatCost(exec.costUsd)}</span></div>
            <div><span className="text-ink-1">{dt.label_tokens}</span> <span className="text-ink-1">{tokens ?? '—'}</span></div>
            <div><span className="text-ink-1">{dt.label_started}</span> <span className="text-ink-1"><AbsoluteTime timestamp={exec.startedAt} /></span></div>
            <div><span className="text-ink-1">{dt.label_completed}</span> <span className="text-ink-1"><AbsoluteTime timestamp={exec.completedAt} /></span></div>
          </div>
          {exec.errorMessage && (
            <div className="p-2 rounded-card bg-status-error/5 border border-status-error/10 typo-caption text-status-error">
              {exec.errorMessage}
            </div>
          )}
          {exec.inputData && (
            <div className="space-y-1">
              <span className="typo-caption text-ink-2">{dt.label_input}</span>
              <pre className="typo-caption text-ink-1 bg-surface-2 p-2 rounded-card overflow-auto max-h-32 border border-hair">
                {exec.inputData}
              </pre>
            </div>
          )}

          {/* Execution output viewer */}
          {(() => {
            if (!output) {
              return (
                <Button
                  type="button"
                  onClick={onFetchOutput}
                  variant="accent"
                  tone="agent"
                  size="sm"
                  icon={<Terminal className="w-3 h-3" />}
                >{dt.view_output}</Button>
              );
            }
            if (output.loading) {
              return (
                <div className="flex items-center gap-2 typo-caption text-ink-2">
                  <LoadingSpinner size="sm" /> {dt.fetching_output}
                </div>
              );
            }
            if (output.error) {
              return (
                <div className="p-2 rounded-card bg-status-error/5 border border-status-error/10 typo-caption text-status-error">
                  {output.error}
                </div>
              );
            }
            if (output.lines.length === 0) {
              return (
                <p className="typo-caption text-ink-2 italic">{dt.no_output}</p>
              );
            }
            return (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="typo-caption text-ink-2 flex items-center gap-1">
                    <Terminal className="w-3 h-3" /> {dt.output_prefix}{output.lines.length} {dt.output_lines_suffix}
                  </span>
                  <Button
                    type="button"
                    onClick={onRefreshOutput ?? onFetchOutput}
                    aria-label={t.common.refresh}
                    data-testid={`cloud-exec-output-refresh-${exec.id}`}
                    variant="ghost"
                    size="icon-sm"
                    icon={<RefreshCw className="w-3 h-3" />}
                  />
                </div>
                <pre className="typo-code text-status-success bg-surface-2 p-3 rounded-card overflow-auto max-h-64 border border-hair">
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
