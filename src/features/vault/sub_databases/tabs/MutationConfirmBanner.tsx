import { AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface MutationConfirmBannerProps {
  /** The pending mutation query text (already known non-null by the caller). */
  pendingMutation: string;
  /** Hint copy — differs slightly between the Console tab and the saved-query editor. */
  hint: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Outer wrapper spacing — the two call sites use different vertical margins. */
  className?: string;
}

const DEFAULT_CLASS_NAME = 'mx-4 mb-3 p-3 rounded-modal bg-status-warning/8 border border-status-warning/20 space-y-2.5';

/**
 * Confirmation banner shown when safe mode intercepts a mutating query
 * (DELETE/UPDATE/INSERT/...). Shared by ChatTab, ConsoleTab, and
 * QueryEditorPane — previously copy-pasted across them with only the hint
 * text (and, for ChatTab, the prop name) differing.
 */
export function MutationConfirmBanner({
  pendingMutation,
  hint,
  onConfirm,
  onCancel,
  className,
}: MutationConfirmBannerProps) {
  const { t } = useTranslation();
  const db = t.vault.databases;

  return (
    <div data-testid="db-mutation-confirm" className={className ?? DEFAULT_CLASS_NAME}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-status-warning mt-0.5 shrink-0" />
        <div className="space-y-1 min-w-0">
          <p className="typo-body text-status-warning/90">{db.modifies_data}</p>
          <p className="typo-body text-foreground">{hint}</p>
          {/* The whole statement stays readable (scroll), never truncated: the
              user is being asked to authorise exactly this text, and a cut at
              200 characters hides the WHERE clause of a long DELETE — the one
              part that decides how much it destroys. */}
          <pre className="typo-code text-foreground bg-surface-1 rounded-card px-2.5 py-1.5 overflow-auto max-h-20 border border-hair">
            {pendingMutation}
          </pre>
        </div>
      </div>
      <div className="flex items-center gap-2 pl-6">
        <button
          type="button"
          data-testid="db-mutation-confirm-run"
          onClick={onConfirm}
          className="px-3 py-1.5 rounded-modal typo-body bg-status-warning/15 text-status-warning border border-status-warning/25 hover:bg-status-warning/25 transition-colors"
        >
          {db.execute_anyway}
        </button>
        <button
          type="button"
          data-testid="db-mutation-confirm-cancel"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-modal typo-body text-foreground hover:text-ink-2 hover:bg-surface-2 border border-transparent hover:border-hair transition-colors"
        >
          {t.common.cancel}
        </button>
      </div>
    </div>
  );
}
