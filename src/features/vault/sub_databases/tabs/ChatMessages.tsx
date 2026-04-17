import { X, Sparkles, Loader2 } from 'lucide-react';
import { AssistantSqlBlock } from './AssistantSqlBlock';
import { useTranslation } from '@/i18n/useTranslation';
import type { QueryResult } from '@/api/vault/database/dbSchema';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  explanation?: string;
  result?: QueryResult;
  error?: string;
  status: 'pending' | 'generating' | 'ready' | 'executing' | 'done' | 'failed';
}

interface ChatMessagesProps {
  messages: ChatMessage[];
  scrollRef: React.RefObject<HTMLDivElement | null>;
  language: string;
  copiedSql: string | null;
  suggestions: string[];
  onCancel: () => void;
  onExecuteSql: (msgId: string, sql: string) => void;
  onCopySql: (sql: string, msgId: string) => void;
  onEditSql: (msgId: string, newSql: string) => void;
  onSuggestionClick: (suggestion: string) => void;
}

export function ChatMessages({
  messages,
  scrollRef,
  language,
  copiedSql,
  suggestions,
  onCancel,
  onExecuteSql,
  onCopySql,
  onEditSql,
  onSuggestionClick,
}: ChatMessagesProps) {
  const { t } = useTranslation();

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
      {messages.length === 0 && (
        <EmptyState
          language={language}
          suggestions={suggestions}
          onSuggestionClick={onSuggestionClick}
        />
      )}

      {messages.map((msg) => (
        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`max-w-[85%] rounded-2xl px-4 py-3 ${
              msg.role === 'user'
                ? 'bg-violet-500/10 border border-violet-500/15 text-foreground/85'
                : 'bg-secondary/30 border border-primary/10 text-foreground'
            }`}
          >
            {msg.role === 'user' && (
              <p className="typo-body whitespace-pre-wrap">{msg.content}</p>
            )}

            {msg.role === 'assistant' && msg.status === 'generating' && (
              <div className="flex items-center gap-2 typo-body text-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{t.vault.databases.generating_query}</span>
                <button
                  onClick={onCancel}
                  className="ml-2 p-1 rounded-card hover:bg-red-500/10 text-foreground hover:text-red-400 transition-colors"
                  title="Cancel"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {msg.role === 'assistant' && msg.status === 'failed' && (
              <p className="typo-body text-red-400">{msg.content}</p>
            )}

            {msg.role === 'assistant' && msg.sql && msg.status !== 'generating' && msg.status !== 'failed' && (
              <AssistantSqlBlock
                msg={msg}
                language={language}
                copiedSql={copiedSql}
                onCopySql={onCopySql}
                onEditSql={onEditSql}
                onExecuteSql={onExecuteSql}
              />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  language,
  suggestions,
  onSuggestionClick,
}: {
  language: string;
  suggestions: string[];
  onSuggestionClick: (s: string) => void;
}) {
  const { t, tx } = useTranslation();
  const db = t.vault.databases;
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
      <div className="w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
        <Sparkles className="w-6 h-6 text-violet-400" />
      </div>
      <div>
        <p className="typo-body font-medium text-foreground">{db.ask_plain_english}</p>
        <p className="typo-body text-foreground mt-1 max-w-md">
          {tx(db.describe_query, { language: language === 'sql' ? 'SQL' : language })}
        </p>
      </div>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 max-w-lg justify-center mt-2">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => onSuggestionClick(s)}
              className="px-3 py-1.5 rounded-modal typo-body text-foreground bg-secondary/30 border border-primary/10 hover:bg-secondary/50 hover:text-muted-foreground/80 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

