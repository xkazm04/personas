import { useState, useCallback, useRef, useEffect } from 'react';
import { useVaultStore } from "@/stores/vaultStore";
import { useKeyedCopyFlag } from '@/hooks/utility/interaction/useKeyedCopyFlag';
import { startNlQuery, getNlQuerySnapshot, cancelNlQuery } from '@/api/vault/database/nlQuery';
import type { ConversationTurn, NlQuerySnapshot } from '@/api/vault/database/nlQuery';
import { ChatMessages, type ChatMessage } from './ChatMessages';
import { ChatInput } from './ChatInput';
import { MutationConfirmBanner } from './MutationConfirmBanner';
import { ConnectorCapabilityNote } from './ConnectorCapabilityNote';
import { useQuerySafeMode } from '../hooks/useQuerySafeMode';
import { extractErrorMessage } from '../safeModeUtils';
import { silentCatch } from '@/lib/silentCatch';
import { trackInteraction } from '@/lib/sentry';
import { getNlDatabaseDialect } from '../introspectionQueries';
import { useTranslation } from '@/i18n/useTranslation';

// If the backend job never reaches a terminal status (crash, dropped job,
// stuck snapshot), stop polling after this long instead of locking the chat
// input forever.
const NL_QUERY_POLL_TIMEOUT_MS = 60_000;

/**
 * Telemetry category for the NL-query lane. This is the most expensive surface
 * in the database console — one model call per question — and was the least
 * observable: generation, failure, the 60s timeout, and whether the generated
 * statement was ever actually RUN all resolved into local component state and
 * nothing else, so "does the AI lane produce SQL people run?" had no answer.
 *
 * Labels are fixed enumerations only. No question text, no generated SQL, no
 * connector identity ever leaves the app through here.
 */
const NL_TELEMETRY = 'db_nl_query';


interface ChatTabProps {
  credentialId: string;
  language: string;
  serviceType: string;
}

let chatIdCounter = 0;
function nextId() { return `chat-${Date.now()}-${++chatIdCounter}`; }

export function ChatTab({ credentialId, language, serviceType }: ChatTabProps) {
  const { t } = useTranslation();
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

  const dbType = getNlDatabaseDialect(serviceType);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Mirror of activeQueryId for the unmount cleanup, which must not re-run
  // (and therefore cannot close over the state value).
  const activeQueryIdRef = useRef<string | null>(null);
  useEffect(() => { activeQueryIdRef.current = activeQueryId; }, [activeQueryId]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      // Leaving the tab stops the poll; without this the backend generation job
      // keeps running (and keeps spending model budget) with nobody reading it.
      const pending = activeQueryIdRef.current;
      if (pending) cancelNlQuery(pending).catch(silentCatch('ChatTab:cancelNlQueryUnmount'));
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

      const pollStartedAt = Date.now();
      pollRef.current = setInterval(async () => {
        if (Date.now() - pollStartedAt > NL_QUERY_POLL_TIMEOUT_MS) {
          clearInterval(pollRef.current);
          pollRef.current = undefined;
          setActiveQueryId(null);
          setGenerating(false);
          cancelNlQuery(queryId).catch(silentCatch('ChatTab:cancelNlQueryTimeout'));
          trackInteraction(NL_TELEMETRY, 'generation_timeout');
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: t.vault.databases.query_timeout, error: t.vault.databases.query_timeout, status: 'failed' as const }
                : m,
            ),
          );
          return;
        }
        try {
          const snapshot: NlQuerySnapshot = await getNlQuerySnapshot(queryId);
          if (snapshot.status === 'completed') {
            trackInteraction(NL_TELEMETRY, 'generated', snapshot.generated_sql ? 'with_sql' : 'no_sql');
            clearInterval(pollRef.current);
            pollRef.current = undefined;
            setActiveQueryId(null);
            setGenerating(false);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, sql: snapshot.generated_sql || undefined, explanation: snapshot.explanation || undefined, content: snapshot.explanation || t.vault.databases.query_generated, status: 'ready' as const }
                  : m,
              ),
            );
          } else if (snapshot.status === 'failed') {
            trackInteraction(NL_TELEMETRY, 'generation_failed');
            clearInterval(pollRef.current);
            pollRef.current = undefined;
            setActiveQueryId(null);
            setGenerating(false);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, content: snapshot.error || t.vault.databases.query_failed, error: snapshot.error || t.vault.databases.query_failed, status: 'failed' as const }
                  : m,
              ),
            );
          }
        } catch (err) { silentCatch("features/vault/sub_databases/tabs/ChatTab:catch1")(err); }
      }, 800);
    } catch (err) {
      trackInteraction(NL_TELEMETRY, 'generation_failed', 'start');
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
  }, [input, generating, credentialId, dbType, buildConversationHistory, t]);

  const handleCancel = useCallback(() => {
    if (activeQueryId) {
      trackInteraction(NL_TELEMETRY, 'generation_cancelled');
      cancelNlQuery(activeQueryId).catch(silentCatch('ChatTab:cancelNlQuery'));
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = undefined; }
      setActiveQueryId(null);
      setGenerating(false);
      setMessages((prev) =>
        prev.map((m) => m.status === 'generating' ? { ...m, content: t.vault.databases.cancelled, status: 'failed' as const } : m),
      );
    }
  }, [activeQueryId, t]);

  // Runs the SQL for whichever message is the current run target. Bound to
  // credentialId only, so the shared safe-mode drift guard clears any pending
  // mutation if the underlying connection changes beneath the user.
  const runQuery = useCallback(async (sql: string, allowMutation: boolean) => {
    const msgId = runTargetMsgIdRef.current;
    if (!msgId) return;
    setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, status: 'executing' as const } : m)));
    // The single question this lane's ROI turns on: was the generated statement
    // actually run, and did it work? `mutation` vs `read` is the only detail
    // carried — never the statement itself.
    const kind = allowMutation ? 'mutation' : 'read';
    try {
      const result = await executeDbQuery(credentialId, sql, undefined, allowMutation);
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, result, error: undefined, status: 'done' as const } : m)));
      trackInteraction(NL_TELEMETRY, 'executed', kind);
    } catch (err) {
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, result: undefined, error: extractErrorMessage(err), status: 'done' as const } : m)));
      trackInteraction(NL_TELEMETRY, 'execute_failed', kind);
    }
  }, [credentialId, executeDbQuery]);

  const { pendingMutation, guardedExecute, confirmMutation, cancelMutation } = useQuerySafeMode(runQuery);

  const handleExecuteSql = useCallback(async (msgId: string, sql: string) => {
    // AI-suggested mutations get the same confirm dialog as the SQL editor,
    // driven by the shared useQuerySafeMode hook (safe mode on by default).
    //
    // Only one message may own the confirm banner at a time. A pending mutation
    // is executed against whatever runTargetMsgIdRef points at when the user
    // confirms, so running a second message while a banner is open would report
    // the FIRST message's rows under the second message. Dropping the stale
    // banner keeps the pending statement and its target in step.
    if (runTargetMsgIdRef.current && runTargetMsgIdRef.current !== msgId) cancelMutation();
    runTargetMsgIdRef.current = msgId;
    await guardedExecute(sql);
  }, [guardedExecute, cancelMutation]);

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

  const suggestions = language === 'redis'
    ? [t.vault.databases.suggestion_redis_keys, t.vault.databases.suggestion_redis_recent]
    : [
        t.vault.databases.suggestion_sql_tables,
        t.vault.databases.suggestion_sql_recent,
        t.vault.databases.suggestion_sql_nulls,
        t.vault.databases.suggestion_sql_duplicates,
      ];

  return (
    <div className="flex flex-col h-full min-h-[500px]">
      {/* The same capability chrome the saved-query toolbar carries
          (QueryToolbar.tsx:46). The chat lane offers a Run button on every
          connector — including key-value and introspection-only ones that
          cannot execute the statement the model just wrote — and had nothing
          at all that said so. */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-primary/8 bg-secondary/5 shrink-0">
        {/* No font-* utility here: typography.css is unlayered, so a weight
            utility beside a typo-* token is silently discarded (the toolbar's
            copy of this chip still carries the dead font-medium). */}
        <span className="typo-body uppercase tracking-wider text-foreground px-2 py-0.5 rounded-card bg-secondary/40 border border-primary/8">
          {language}
        </span>
        <ConnectorCapabilityNote serviceType={serviceType} />
      </div>
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
          pendingMutation={pendingMutation}
          hint={t.vault.databases.modifies_data_hint_short}
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

