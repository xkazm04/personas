import { QueryResultTable } from '../QueryResultTable';
import { useTranslation } from '@/i18n/useTranslation';
import type { QueryResult } from '@/api/vault/database/dbSchema';

interface ResultsTableProps {
  result: QueryResult | null;
  error: string | null;
  executing: boolean;
  language: string;
}

export function ResultsTable({ result, error, executing, language }: ResultsTableProps) {
  const { t } = useTranslation();
  const db = t.vault.databases;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
      {error && (
        <div
          key="error"
          className="animate-fade-slide-in p-3 rounded-modal bg-red-500/8 border border-red-500/15 text-sm text-red-400/90 whitespace-pre-wrap font-mono leading-relaxed"
        >
          {error}
        </div>
      )}
      {result && (
        <div className="animate-fade-slide-in" key="result">
          <QueryResultTable result={result} />
        </div>
      )}
      {!result && !error && !executing && (
        <div key="hint" className="animate-fade-slide-in flex items-center justify-center pt-8">
          <p className="text-sm text-foreground">
            {language === 'redis' ? db.redis_run_hint : db.sql_run_hint}
          </p>
        </div>
      )}
      {executing && (
        <div key="executing" className="animate-fade-slide-in flex items-center justify-center pt-8 gap-2">
          <span className="relative flex h-3 w-3 items-center justify-center">
            <span className="animate-ping absolute h-full w-full rounded-full bg-emerald-400 opacity-40" />
            <span className="relative rounded-full h-1.5 w-1.5 bg-emerald-400" />
          </span>
          <span className="text-sm text-foreground">{db.executing_query}</span>
        </div>
      )}
    </div>
  );
}
