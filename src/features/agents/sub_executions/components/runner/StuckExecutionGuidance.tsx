import { useState } from 'react';
import { AlertTriangle, Clock, ChevronDown, ChevronRight, HelpCircle, RotateCw, FileText, XCircle } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { SilenceLevel } from '../../libs/useRunnerState';

interface StuckExecutionGuidanceProps {
  silenceLevel: SilenceLevel;
  onCancel: () => void;
  executionId: string | null;
  onViewLog?: () => void;
}

export function StuckExecutionGuidance({
  silenceLevel,
  onCancel,
  executionId,
  onViewLog,
}: StuckExecutionGuidanceProps) {
  const [expanded, setExpanded] = useState(false);

  if (silenceLevel === 'active') return null;

  const isStuck = silenceLevel === 'stuck';

  return (
    <div
      className={`animate-fade-slide-in rounded-xl border transition-colors ${
        isStuck
          ? 'border-red-500/30 bg-red-500/5'
          : 'border-amber-500/30 bg-amber-500/5'
      }`}
    >
      {/* Header row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left"
      >
        {isStuck ? (
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
        ) : (
          <Clock className="w-4 h-4 text-amber-400 shrink-0 animate-pulse" />
        )}
        <span
          className={`flex-1 text-sm font-medium ${
            isStuck ? 'text-red-300/90' : 'text-amber-300/90'
          }`}
        >
          {isStuck
            ? 'Execution appears stuck'
            : 'No new output for a while'}
        </span>
        <Tooltip
          content={
            isStuck
              ? 'The agent has not produced output for 2+ minutes. It may be waiting on an external API or encountering an issue.'
              : 'The agent has been silent for over a minute. This can happen during long API calls or complex reasoning.'
          }
        >
          <HelpCircle
            className={`w-3.5 h-3.5 shrink-0 ${
              isStuck ? 'text-red-400/60' : 'text-amber-400/60'
            }`}
          />
        </Tooltip>
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
        )}
      </button>

      {/* Collapsible detail */}
      {expanded && (
        <div className="animate-fade-slide-in px-4 pb-3 space-y-3 border-t border-primary/10 pt-3">
          {/* Explanation */}
          <p className="text-xs text-muted-foreground/80 leading-relaxed">
            {isStuck
              ? 'The agent has not produced any output for over 2 minutes. This usually means it is waiting on a slow external API, the connected service is unresponsive, or the execution process has stalled.'
              : 'The agent has been silent for over a minute. Long pauses can occur during complex reasoning or when waiting for API responses. If the silence continues, the status will escalate.'}
          </p>

          {/* Suggested actions */}
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Suggested actions
            </p>
            <div className="flex flex-wrap gap-2">
              {isStuck && (
                <button
                  onClick={onCancel}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/20 transition-colors"
                >
                  <XCircle className="w-3 h-3" />
                  Cancel &amp; retry
                </button>
              )}
              {executionId && onViewLog && (
                <button
                  onClick={onViewLog}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                    isStuck
                      ? 'bg-red-500/10 hover:bg-red-500/20 text-red-300/80 border-red-500/15'
                      : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300/80 border-amber-500/15'
                  }`}
                >
                  <FileText className="w-3 h-3" />
                  View execution log
                </button>
              )}
              {!isStuck && (
                <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground/60">
                  <RotateCw className="w-3 h-3" />
                  You can also wait — some operations take time
                </span>
              )}
            </div>
          </div>

          {/* Connectivity hint */}
          {isStuck && (
            <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
              Tip: Check if the connected API or service is responding. Network
              issues or rate limits can cause prolonged silence.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
