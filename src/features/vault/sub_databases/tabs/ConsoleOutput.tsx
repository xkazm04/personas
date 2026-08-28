import { QueryResultTable } from '../QueryResultTable';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { useTranslation } from '@/i18n/useTranslation';
import type { QueryResult } from '@/api/vault/database/dbSchema';

interface ConsoleOutputProps {
  result: QueryResult | null;
  error: string | null;
  executing: boolean;
  pendingMutation: string | null;
  language: string;
}

/**
 * The console's result pane. Renders the same four states as the saved-query
 * editor's `ResultsTable` (error / result / idle hint / executing) with the same
 * mechanics — shared InlineErrorBanner, the same entry animation, the same
 * executing indicator — so the two panes cannot drift apart again. The only
 * deliberate differences are this pane's own idle copy and the extra
 * `pendingMutation` guard, which keeps the hint from flashing back while the
 * safe-mode confirm banner is open.
 *
 * The executing indicator is a pulsing dot, NOT feedback/LoadingSpinner: that
 * component renders null, so the previous version showed an unlabelled gap.
 */
export function ConsoleOutput({ result, error, executing, pendingMutation, language }: ConsoleOutputProps) {
  const { t } = useTranslation();
  const db = t.vault.databases;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 border-t border-primary/5">
      {error && (
        <InlineErrorBanner key="error" message={error} className="mt-4 animate-fade-slide-in" />
      )}

      {result && (
        <div key="result" className="mt-4 animate-fade-slide-in">
          <QueryResultTable result={result} />
        </div>
      )}

      {!result && !error && !executing && !pendingMutation && (
        <div key="hint" className="animate-fade-slide-in flex items-center justify-center h-full">
          <p className="typo-body text-foreground">
            {language === 'redis' ? db.redis_hint : db.sql_hint}
          </p>
        </div>
      )}

      {executing && (
        <div key="executing" className="animate-fade-slide-in flex items-center justify-center h-full gap-2">
          <span className="relative flex h-3 w-3 items-center justify-center">
            <span className="animate-ping absolute h-full w-full rounded-full bg-status-success opacity-40" />
            <span className="relative rounded-full h-1.5 w-1.5 bg-status-success" />
          </span>
          <span className="typo-body text-foreground">{db.executing_query}</span>
        </div>
      )}
    </div>
  );
}
