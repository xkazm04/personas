import { useState, useCallback, useRef, useEffect } from 'react';
import { useVaultStore } from "@/stores/vaultStore";
import { useKeyedCopyFlag } from '@/hooks/utility/interaction/useKeyedCopyFlag';
import { startNlQuery, getNlQuerySnapshot, cancelNlQuery } from '@/api/vault/database/nlQuery';
import type { ConversationTurn, NlQuerySnapshot } from '@/api/vault/database/nlQuery';
import { ChatMessages, type ChatMessage } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { MutationConfirmBanner } from './MutationConfirmBanner';
import { useQuerySafeMode } from '../hooks/useQuerySafeMode';
import { extractErrorMessage } from '../safeModeUtils';
import { silentCatch } from '@/lib/silentCatch';


interface ChatTabProps {
  credentialId: string;
  language: string;
  serviceType: string;
}

let chatIdCounter = 0;
function nextId() { return `chat-${Date.now()}-${++chatIdCounter}`; }

export function ChatTab({ credentialId, language, serviceType }: ChatTabProps) {
  const executeDbQuery = useVaultStore((s) => s.executeDbQuery);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [generating, setGenerating] = useState(false);
  const [activeQueryId, setActiveQueryId] = useState<string | null>(null);
  const { copiedKey: copiedSql, copy: copySqlText } = useKeyedCopyFlag<string>(1500);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  // The message whose SQL is currently being run/confirmed. Held in a ref so
  // runQuery keeps a stable identity across chat messages (the connection is
  // fixed for the whole ChatTab via credentialId), while still routing the
  // result to the right message.
  const runTargetMsgIdRef = useRef<string | null>(null);

  const dbType = getDatabaseType(serviceType);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const buildConversationHistory = useCallback((): ConversationTurn[] => {
    return messages
      .filter((m) => m.status === 'done' || m.status === 'ready' || m.role === 'user')
      .map((m) => ({
        role: m.role,
        content: m.role === 'user'
          ? m.content
          : m.sql
            ? `Generated SQL:\n\`\`\`sql\n${m.sql}\n\`\`\`\n${m.explanation || ''}`
            : m.content,
      }));
  }, [messages]);

  const handleSubmit = useCallback(async () => {
    const question = input.trim();
    if (!question || generating) return;

    const userMsg: ChatMessage = { id: nextId(), role: 'user', content: question, status: 'done' };
    const assistantMsg: ChatMessage = { id: nextId(), role: 'assistant', content: '', status: 'generating' };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setGenerating(true);

    const queryId = `nlq-${Date.now()}`;
    setActiveQueryId(queryId);

    try {
      const history = buildConversationHistory();
      await startNlQuery(queryId, credentialId, question, history, dbType);

      pollRef.current = setInterval(async () => {
        try {
          const snapshot: NlQuerySnapshot = await getNlQuerySnapshot(queryId);
          if (snapshot.status === 'completed') {
            clearInterval(pollRef.current);
            pollRef.current = undefined;
            setActiveQueryId(null);
            setGenerating(false);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, sql: snapshot.generated_sql || undefined, explanation: snapshot.explanation || undefined, content: snapshot.explanation || 'Query generated.', status: 'ready' as const }
                  : m,
              ),
            );
          } else if (snapshot.status === 'failed') {
            clearInterval(pollRef.current);
            pollRef.current = undefined;
            setActiveQueryId(null);
            setGenerating(false);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, content: snapshot.error || 'Query generation failed.', error: snapshot.error || 'Query generation failed.', status: 'failed' as const }
                  : m,
              ),
            );
          }
        } catch (err) { silentCatch("features/vault/sub_databases/tabs/ChatTab:catch1")(err); }
      }, 800);
    } catch (err) {
      setGenerating(false);
      setActiveQueryId(null);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, content: extractErrorMessage(err), error: extractErrorMessage(err), status: 'failed' as const }
            : m,
        ),
      );
    }
  }, [input, generating, credentialId, dbType, buildConversationHistory]);

  const handleCancel = useCallback(() => {
    if (activeQueryId) {
      cancelNlQuery(activeQueryId).catch(() => {});
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = undefined; }
      setActiveQueryId(null);
      setGenerating(false);
      setMessages((prev) =>
        prev.map((m) => m.status === 'generating' ? { ...m, content: 'Cancelled.', status: 'failed' as const } : m),
      );
    }
  }, [activeQueryId]);

  // Runs the SQL for whichever message is the current run target. Bound to
  // credentialId only, so the shared safe-mode drift guard clears any pending
  // mutation if the underlying connection changes beneath the user.
  const runQuery = useCallback(async (sql: string, allowMutation: boolean) => {
    const msgId = runTargetMsgIdRef.current;
    if (!msgId) return;
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, status: 'executing' as const } : m)));
    try {
      const result = await executeDbQuery(credentialId, sql, undefined, allowMutation);
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, result, error: undefined, status: 'done' as const } : m)));
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, error: extractErrorMessage(err), status: 'done' as const } : m)));
    }
  }, [credentialId, executeDbQuery]);

  const { pendingMutation, guardedExecute, confirmMutation, cancelMutation } = useQuerySafeMode(runQuery);

  const handleExecuteSql = useCallback(async (msgId: string, sql: string) => {
    // AI-suggested mutations get the same confirm dialog as the SQL editor,
    // driven by the shared useQuerySafeMode hook (safe mode on by default).
    runTargetMsgIdRef.current = msgId;
    await guardedExecute(sql);
  }, [guardedExecute]);

  const handleCopySql = useCallback((sql: string, msgId: string) => {
    copySqlText(msgId, sql);
  }, [copySqlText]);

  const handleEditSql = useCallback((msgId: string, newSql: string) => {
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, sql: newSql } : m)));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
    },
    [handleSubmit],
  );

  const suggestions = getSuggestions(language);

  return (
    <div className="flex flex-col h-full min-h-[500px]">
      <ChatMessages
        messages={messages}
        scrollRef={scrollRef}
        language={language}
        copiedSql={copiedSql}
        suggestions={suggestions}
        onCancel={handleCancel}
        onExecuteSql={handleExecuteSql}
        onCopySql={handleCopySql}
        onEditSql={handleEditSql}
        onSuggestionClick={(s) => { setInput(s); inputRef.current?.focus(); }}
      />
      {pendingMutation && (
        <MutationConfirmBanner
          sql={pendingMutation}
          onConfirm={confirmMutation}
          onCancel={cancelMutation}
          className="mx-4 mb-2"
        />
      )}
      <ChatInput
        input={input}
        generating={generating}
        hasMessages={messages.length > 0}
        inputRef={inputRef}
        onInputChange={setInput}
        onKeyDown={handleKeyDown}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </div>
  );
}

function getDatabaseType(serviceType: string): string {
  switch (serviceType) {
    case 'supabase': case 'neon': return 'postgresql';
    case 'planetscale': return 'mysql';
    case 'upstash': case 'redis': return 'redis';
    default: return 'sql';
  }
}

function getSuggestions(lang: string): string[] {
  return lang === 'redis'
    ? ['Show all keys matching "user:*"', 'Get the 10 most recent entries']
    : ['Show me all tables and their row counts', 'Find the 10 most recent records', 'List columns with null values', 'Show duplicate entries'];
}
