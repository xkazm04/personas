import { Wrench, RotateCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface CancelledResumeFooterProps {
  /** Name of the tool that was in-flight when the execution was cancelled, if known. */
  lastTool?: string | null;
  onResume: () => void;
}

/**
 * Shared "stopped while running <tool> + Resume from here" block rendered by
 * both PersonaRunner's inline cancelled-summary and ExecutionSummaryCard.
 * Previously copy-pasted between the two (identical markup, i18n tokens) —
 * extracted so status-header/resume affordance changes only need to land once.
 */
export function CancelledResumeFooter({ lastTool, onResume }: CancelledResumeFooterProps) {
  const { t } = useTranslation();
  return (
    <div className="mt-3 pt-3 border-t border-amber-500/15 space-y-3">
      {lastTool && (
        <div className="flex items-center gap-2 typo-body text-foreground">
          <Wrench className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0" />
          <span>{t.agents.executions.stopped_while_running}</span>
          <code className="px-1.5 py-0.5 rounded-card bg-amber-500/10 text-amber-300/80 typo-code">
            {lastTool}
          </code>
        </div>
      )}
      <button
        onClick={onResume}
        className="flex items-center gap-2 px-3.5 py-2 typo-heading rounded-modal bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 hover:text-amber-200 transition-colors"
      >
        <RotateCw className="w-3.5 h-3.5" />
        {t.agents.executions.resume_from_here}
      </button>
    </div>
  );
}
