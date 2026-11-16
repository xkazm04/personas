import { X, Loader2 } from 'lucide-react';
import { AssistantSqlBlock } from './AssistantSqlBlock';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { QueryResult } from '@/api/vault/database/dbSchema';
import Button from '@/features/shared/components/buttons/Button';

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
  onCancelExecution?: (msgId: string) => void;
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
  onCancelExecution,
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
            className={`max-w-[85%] rounded-card px-4 py-3 ${
              msg.role === 'user'
                ? 'bg-role-agent/10 border border-role-agent/15 text-ink-1'
                : 'bg-surface-1 border border-hair text-foreground'
            }`}
          >
            {msg.role === 'user' && (
              <p className="typo-body whitespace-pre-wrap">{msg.content}</p>
            )}

            {msg.role === 'assistant' && msg.status === 'generating' && (
              <div className="flex items-center gap-2 typo-body text-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{t.vault.databases.generating_query}</span>
                <Tooltip content={t.common.cancel}>
                  <Button
                    type="button"
                    onClick={onCancel}
                    variant="ghost"
                    size="icon-sm"
                    className="ml-2"
                    aria-label={t.common.cancel}
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </Tooltip>
              </div>
            )}

            {msg.role === 'assistant' && msg.status === 'failed' && (
              <p className="typo-body text-status-error">{msg.content}</p>
            )}

            {/* An answer that carries no SQL (a clarifying question, a refusal,
                an explanation-only reply) still has to be readable — without
                this branch the bubble renders completely empty. */}
            {msg.role === 'assistant' && !msg.sql && msg.content
              && msg.status !== 'generating' && msg.status !== 'failed' && (
              <p className="typo-body whitespace-pre-wrap">{msg.content}</p>
            )}

            {msg.role === 'assistant' && msg.sql && msg.status !== 'generating' && msg.status !== 'failed' && (
              <AssistantSqlBlock
                msg={msg}
                language={language}
                copiedSql={copiedSql}
                onCopySql={onCopySql}
                onEditSql={onEditSql}
                onExecuteSql={onExecuteSql}
                onCancelExecution={onCancelExecution}
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
    <ScenarioEmptyState
      art="chat"
      title={db.ask_plain_english}
      description={tx(db.describe_query, { language: language === 'sql' ? 'SQL' : language })}
      className="h-full"
    >
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 max-w-lg justify-center mt-2">
          {suggestions.map((s, i) => (
            <Button
              type="button"
              key={i}
              onClick={() => onSuggestionClick(s)}
              variant="secondary"
              size="sm"
            >
              {s}
            </Button>
          ))}
        </div>
      )}
    </ScenarioEmptyState>
  );
}

