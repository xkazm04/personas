import { Loader2, Play, Copy, Check, X } from 'lucide-react';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { SqlEditor } from '../SqlEditor';
import { QueryResultTable } from '../QueryResultTable';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { ChatMessage } from './ChatMessages';

interface AssistantSqlBlockProps {
  msg: ChatMessage;
  language: string;
  copiedSql: string | null;
  onCopySql: (sql: string, msgId: string) => void;
  onEditSql: (msgId: string, newSql: string) => void;
  onExecuteSql: (msgId: string, sql: string) => void;
  /** Cancels the in-flight execution of THIS message's statement. */
  onCancelExecution?: (msgId: string) => void;
}

export function AssistantSqlBlock({
  msg,
  language,
  copiedSql,
  onCopySql,
  onEditSql,
  onExecuteSql,
  onCancelExecution,
}: AssistantSqlBlockProps) {
  const { t, tx } = useTranslation();
  const db = t.vault.databases;

  return (
    <div className="space-y-3">
      {msg.explanation && (
        <p className="typo-body text-foreground">{msg.explanation}</p>
      )}

      <div className="rounded-modal border border-hair overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 bg-surface-2 border-b border-hair">
          <span className="typo-label text-foreground">
            {tx(db.generated_label, { language: language === 'sql' ? 'SQL' : language })}
          </span>
          <div className="flex items-center gap-1">
            <Tooltip content={db.copy_sql}>
              <button
                type="button"
                onClick={() => onCopySql(msg.sql!, msg.id)}
                className="p-1 rounded-interactive hover:bg-surface-2 text-foreground hover:text-ink-2 transition-colors"
                aria-label={db.copy_sql}
              >
                {copiedSql === msg.id ? (
                  <Check className="w-3 h-3 text-status-success" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            </Tooltip>
          </div>
        </div>
        <div className="max-h-[200px] overflow-auto">
          <SqlEditor
            value={msg.sql!}
            onChange={(newSql) => onEditSql(msg.id, newSql)}
            language={language}
            minHeight="60px"
          />
        </div>
      </div>

      {(msg.status === 'ready' || msg.status === 'done') && (
        <button
          type="button"
          data-testid="chat-run-sql"
          onClick={() => onExecuteSql(msg.id, msg.sql!)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal typo-body bg-status-success/10 text-status-success border border-status-success/20 hover:bg-status-success/20 transition-colors"
        >
          <Play className="w-3 h-3" />
          {msg.result ? db.rerun_query : db.run_query}
        </button>
      )}

      {msg.status === 'executing' && (
        <div className="flex items-center gap-2 typo-body text-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>{db.executing}</span>
          {/* The typed console and the saved-query editor have both offered a
              stop button since useDbQueryRunner grew a cancellation handle.
              The chat lane ran its generated statement with no execution id at
              all, so a runaway SELECT here was a wait for the backend's own
              QUERY_TIMEOUT and nothing else. */}
          {onCancelExecution && (
            <button
              type="button"
              data-testid="chat-cancel-sql"
              onClick={() => onCancelExecution(msg.id)}
              aria-label={t.common.cancel}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-modal typo-caption text-status-error hover:bg-status-error/20 transition-colors focus-ring"
            >
              <X className="w-3 h-3" aria-hidden="true" />
              {t.common.cancel}
            </button>
          )}
        </div>
      )}

      {msg.error && msg.status === 'done' && (
        // `white-space` and `font-family` both inherit, so putting them on the
        // banner keeps a multi-line engine error readable — the one property
        // the hand-painted div had that the shared banner does not paint itself.
        <InlineErrorBanner message={msg.error} className="whitespace-pre-wrap font-mono" />
      )}

      {msg.result && (
        <QueryResultTable result={msg.result} />
      )}
    </div>
  );
}
