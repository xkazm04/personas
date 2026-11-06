import { Wrench, RotateCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface CancelledResumeFooterProps {
  /** Name of the tool that was in-flight when the execution was cancelled, if known. */
  lastTool?: string | null;
  onResume: () => void;
}

/**
 * Shared "stopped while running <tool> + Resume from here" block rendered by
 * by PersonaRunner's inline cancelled-summary. ExecutionSummaryCard also
 * rendered it behind an `onResume` prop that no caller ever passed, so that
 * branch was removed (2026-10-19); wire a real resume before re-adding it.
 */
export function CancelledResumeFooter({ lastTool, onResume }: CancelledResumeFooterProps) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 pt-3 border-t border-status-warning/15 space-y-3">
      {lastTool && (
        <div className="flex items-center gap-2 typo-body text-ink-1">
          <Wrench className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />
          <span>{t.agents.executions.stopped_while_running}</span>
          <code className="inline-flex items-center text-status-warning typo-code">
            {lastTool}
          </code>
        </div>
      )}
      <button
        type="button"
        onClick={onResume}
        className="flex items-center gap-2 px-3.5 py-2 typo-heading rounded-modal bg-status-warning/10 text-status-warning border border-status-warning/20 hover:bg-status-warning/20 hover:text-status-warning transition-colors"
      >
        <RotateCw className="w-3.5 h-3.5" />
        {t.agents.executions.resume_from_here}
      </button>
    </div>
  );
}
