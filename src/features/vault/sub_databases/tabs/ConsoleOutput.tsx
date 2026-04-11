import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { QueryResultTable } from '../QueryResultTable';
import { useTranslation } from '@/i18n/useTranslation';
import type { QueryResult } from '@/api/vault/database/dbSchema';

interface ConsoleOutputProps {
  result: QueryResult | null;
  error: string | null;
  executing: boolean;
  pendingMutation: string | null;
  language: string;
}

export function ConsoleOutput({ result, error, executing, pendingMutation, language }: ConsoleOutputProps) {
  const { t } = useTranslation();
  const db = t.vault.databases;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 border-t border-primary/5">
      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 whitespace-pre-wrap font-mono">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-4">
          <QueryResultTable result={result} />
        </div>
      )}

      {!result && !error && !executing && !pendingMutation && (
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-muted-foreground/60">
            {language === 'redis' ? db.redis_hint : db.sql_hint}
          </p>
        </div>
      )}

      {executing && (
        <div className="flex items-center justify-center h-full gap-2">
          <LoadingSpinner className="text-muted-foreground/60" />
          <span className="text-sm text-muted-foreground/60">{db.executing_query}</span>
        </div>
      )}
    </div>
  );
}
