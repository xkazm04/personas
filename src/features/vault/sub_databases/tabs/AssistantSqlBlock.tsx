import { Loader2, Play, Copy, Check } from 'lucide-react';
import { SqlEditor } from '../SqlEditor';
import { QueryResultTable } from '../QueryResultTable';
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
        <p className="text-sm text-foreground">{msg.explanation}</p>
      )}

      <div className="rounded-modal border border-primary/10 overflow-hidden">
        <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/40 border-b border-primary/10">
          <span className="text-xs font-medium text-foreground uppercase tracking-wide">
            {tx(db.generated_label, { language: language === 'sql' ? 'SQL' : language })}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onCopySql(msg.sql!, msg.id)}
              className="p-1 rounded hover:bg-secondary/50 text-foreground hover:text-muted-foreground/70 transition-colors"
              title={db.copy_sql}
            >
              {copiedSql === msg.id ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
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
          onClick={() => onExecuteSql(msg.id, msg.sql!)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-modal text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
        >
          <Play className="w-3 h-3" />
          {msg.result ? db.rerun_query : db.run_query}
        </button>
      )}

      {msg.status === 'executing' && (
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>{db.executing}</span>
        </div>
      )}

      {msg.error && msg.status === 'done' && (
        <div className="p-3 rounded-card bg-red-500/10 border border-red-500/20 text-sm text-red-400 whitespace-pre-wrap font-mono">
          {msg.error}
        </div>
      )}

      {msg.result && (
        <QueryResultTable result={msg.result} />
      )}
    </div>
  );
}
