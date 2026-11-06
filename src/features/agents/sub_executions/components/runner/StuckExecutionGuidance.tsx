import { useState } from 'react';
import { AlertTriangle, Clock, ChevronDown, ChevronRight, HelpCircle, RotateCw, FileText, XCircle } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { SilenceLevel } from '../../libs/useRunnerState';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

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
          ? 'border-status-error/30 bg-status-error/5'
          : 'border-status-warning/30 bg-status-warning/5'
      }`}
    >
      {/* Header row */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left"
      >
        {isStuck ? (
          <AlertTriangle className="w-4 h-4 text-status-error shrink-0" />
        ) : (
          <Clock className="w-4 h-4 text-status-warning shrink-0" />
        )}
        <span
          className={`flex-1 typo-body ${
            isStuck ? 'text-status-error' : 'text-status-warning'
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
              isStuck ? 'text-status-error' : 'text-status-warning'
            }`}
          />
        </Tooltip>
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-ink-1" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-ink-1" />
        )}
      </button>

      {/* Collapsible detail */}
      {expanded && (
        <div className="animate-fade-slide-in px-4 pb-3 space-y-3 border-t border-hair pt-3">
          {/* Explanation */}
          <p className="typo-caption text-ink-2">
            {isStuck
              ? e.stuck_detail
              : e.silent_detail}
          </p>

          {/* Suggested actions */}
          <div className="space-y-2">
            <p className="typo-eyebrow text-ink-1">
              {e.suggested_actions}
            </p>
            <div className="flex flex-wrap gap-2">
              {isStuck && (
                <Button
                  type="button"
                  onClick={onCancel}
                  variant="danger"
                  size="sm"
                  icon={<XCircle className="w-3 h-3" />}
                >{e.cancel_retry}</Button>
              )}
              {executionId && onViewLog && (
                <button
                  type="button"
                  onClick={onViewLog}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption transition-colors border ${
                    isStuck
                      ? 'bg-status-error/10 hover:bg-status-error/20 text-status-error border-status-error/15'
                      : 'bg-status-warning/10 hover:bg-status-warning/20 text-status-warning border-status-warning/15'
                  }`}
                >
                  <FileText className="w-3 h-3" />
                  {e.view_execution_log}
                </button>
              )}
              {!isStuck && (
                <span className="flex items-center gap-1.5 px-3 py-1.5 typo-caption text-ink-2">
                  <RotateCw className="w-3 h-3" />
                  {e.wait_hint}
                </span>
              )}
            </div>
          </div>

          {/* Connectivity hint */}
          {isStuck && (
            <p className="typo-caption text-ink-2 leading-relaxed">
              {e.connectivity_tip}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
