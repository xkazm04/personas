import { useState } from 'react';
import { AlertTriangle, Clock, ChevronDown, ChevronRight, HelpCircle, RotateCw, FileText, XCircle } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { SilenceLevel } from '../../libs/useRunnerState';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t } = useTranslation();
  const e = t.agents.executions;
  const [expanded, setExpanded] = useState(false);

  if (silenceLevel === 'active') return null;

  const isStuck = silenceLevel === 'stuck';

  return (
    <div
      className={`animate-fade-slide-in rounded-modal border transition-colors ${
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
            ? e.execution_stuck
            : e.no_new_output}
        </span>
        <Tooltip
          content={
            isStuck
              ? e.stuck_tooltip
              : e.silent_tooltip
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
              ? e.stuck_detail
              : e.silent_detail}
          </p>

          {/* Suggested actions */}
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
              {e.suggested_actions}
            </p>
            <div className="flex flex-wrap gap-2">
              {isStuck && (
                <button
                  onClick={onCancel}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-card text-xs font-medium bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/20 transition-colors"
                >
                  <XCircle className="w-3 h-3" />
                  {e.cancel_retry}
                </button>
              )}
              {executionId && onViewLog && (
                <button
                  onClick={onViewLog}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-card text-xs font-medium transition-colors border ${
                    isStuck
                      ? 'bg-red-500/10 hover:bg-red-500/20 text-red-300/80 border-red-500/15'
                      : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300/80 border-amber-500/15'
                  }`}
                >
                  <FileText className="w-3 h-3" />
                  {e.view_execution_log}
                </button>
              )}
              {!isStuck && (
                <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground/60">
                  <RotateCw className="w-3 h-3" />
                  {e.wait_hint}
                </span>
              )}
            </div>
          </div>

          {/* Connectivity hint */}
          {isStuck && (
            <p className="text-[11px] text-muted-foreground/50 leading-relaxed">
              {e.connectivity_tip}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
