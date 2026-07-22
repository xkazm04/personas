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

const DEFAULT_CLASS_NAME = 'mx-4 mb-3 p-3 rounded-modal bg-amber-500/8 border border-amber-500/20 space-y-2.5';

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
        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="space-y-1 min-w-0">
          <p className="typo-body font-medium text-amber-300/90">{db.modifies_data}</p>
          <p className="typo-body text-foreground">{hint}</p>
          <pre className="typo-code font-mono text-foreground bg-secondary/30 rounded-card px-2.5 py-1.5 overflow-x-auto max-h-20 border border-primary/5">
            {pendingMutation.length > 200 ? pendingMutation.slice(0, 200) + '...' : pendingMutation}
          </pre>
        </div>
      </div>
      <div className="flex items-center gap-2 pl-6">
        <button
          data-testid="db-mutation-confirm-run"
          onClick={onConfirm}
          className="px-3 py-1.5 rounded-modal typo-body font-medium bg-amber-500/15 text-amber-400 border border-amber-500/25 hover:bg-amber-500/25 transition-colors"
        >
          {db.execute_anyway}
        </button>
        <button
          data-testid="db-mutation-confirm-cancel"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-modal typo-body font-medium text-foreground hover:text-muted-foreground/70 hover:bg-secondary/40 border border-transparent hover:border-primary/10 transition-colors"
        >
          {t.common.cancel}
        </button>
      </div>
    </div>
  );
}
