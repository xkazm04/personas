import { Loader2, Play, Copy, Check } from 'lucide-react';
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
}

export function AssistantSqlBlock({
  msg,
  language,
  copiedSql,
  onCopySql,
  onEditSql,
  onExecuteSql,
}: AssistantSqlBlockProps) {
  const { t, tx } = useTranslation();
  const db = t.vault.databases;

  return (
    <div className="space-y-3">
      {msg.explanation && (
        <p className="typo-body text-foreground">{msg.explanation}</p>
      )}

      <div className="rounded-modal border border-primary/10 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/40 border-b border-primary/10">
          <span className="typo-label font-medium text-foreground">
            {tx(db.generated_label, { language: language === 'sql' ? 'SQL' : language })}
          </span>
          <div className="flex items-center gap-1">
            <Tooltip content={db.copy_sql}>
              <button
                type="button"
                onClick={() => onCopySql(msg.sql!, msg.id)}
                className="p-1 rounded hover:bg-secondary/50 text-foreground hover:text-muted-foreground/70 transition-colors"
                aria-label={db.copy_sql}
              >
                {copiedSql === msg.id ? (
                  <Check className="w-3 h-3 text-emerald-400" />
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal typo-body font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
        >
          <Play className="w-3 h-3" />
          {msg.result ? db.rerun_query : db.run_query}
        </button>
      )}

      {msg.status === 'executing' && (
        <div className="flex items-center gap-2 typo-body text-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>{db.executing}</span>
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
