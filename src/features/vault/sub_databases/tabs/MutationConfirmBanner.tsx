import { AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface MutationConfirmBannerProps {
  /** The pending mutation SQL awaiting confirmation. */
  sql: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Outer container classes (margins differ between editor and chat). */
  className?: string;
}

/**
 * Shared "this query modifies data" confirmation banner.
 *
 * Presentational only — all safety logic lives in `useQuerySafeMode`. Rendered
 * identically by the SQL editor (QueryEditorPane) and the AI chat (ChatTab) so
 * the confirm affordance can never drift between the two surfaces.
 */
export function MutationConfirmBanner({ sql, onConfirm, onCancel, className = 'mx-4 mt-2' }: MutationConfirmBannerProps) {
  const { t } = useTranslation();
  const db = t.vault.databases;

  return (
    <div
      data-testid="db-mutation-confirm"
      className={`${className} p-3 rounded-modal bg-amber-500/8 border border-amber-500/20 space-y-2.5`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="space-y-1 min-w-0">
          <p className="typo-body font-medium text-amber-300/90">{db.modifies_data}</p>
          <p className="typo-body text-foreground">{db.modifies_data_hint_short}</p>
          <pre className="typo-code font-mono text-foreground bg-secondary/30 rounded-card px-2.5 py-1.5 overflow-x-auto max-h-20 border border-primary/5">
            {sql.length > 200 ? sql.slice(0, 200) + '...' : sql}
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
