import { useState, useCallback, useRef, useEffect } from 'react';
import { Send, Loader2, Play, Copy, Check, Sparkles, X, CornerDownLeft } from 'lucide-react';
import { useVaultStore } from "@/stores/vaultStore";
import { SqlEditor } from '../SqlEditor';
import { QueryResultTable } from '../QueryResultTable';
import { startNlQuery, getNlQuerySnapshot, cancelNlQuery } from '@/api/vault/database/nlQuery';
import type { ConversationTurn, NlQuerySnapshot } from '@/api/vault/database/nlQuery';
import type { QueryResult } from '@/api/vault/database/dbSchema';

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'error' in err) {
    return String((err as Record<string, unknown>).error);
  }
  if (typeof err === 'string') return err;
  try { return JSON.stringify(err); } catch { return 'Unknown error'; }
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  explanation?: string;
  result?: QueryResult;
  error?: string;
  status: 'pending' | 'generating' | 'ready' | 'executing' | 'done' | 'failed';
}

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
  const [copiedSql, setCopiedSql] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const dbType = getDatabaseType(serviceType);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Cleanup poll on unmount
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

    const userMsg: ChatMessage = {
      id: nextId(),
      role: 'user',
      content: question,
      status: 'done',
    };
    const assistantMsg: ChatMessage = {
      id: nextId(),
      role: 'assistant',
      content: '',
      status: 'generating',
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setGenerating(true);

    const queryId = `nlq-${Date.now()}`;
    setActiveQueryId(queryId);

    try {
      const history = buildConversationHistory();
      await startNlQuery(queryId, credentialId, question, history, dbType);

      // Poll for results
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
                  ? {
                      ...m,
                      sql: snapshot.generated_sql || undefined,
                      explanation: snapshot.explanation || undefined,
                      content: snapshot.explanation || 'Query generated.',
                      status: 'ready' as const,
                    }
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
                  ? {
                      ...m,
                      content: snapshot.error || 'Query generation failed.',
                      error: snapshot.error || 'Query generation failed.',
                      status: 'failed' as const,
                    }
                  : m,
              ),
            );
          }
        } catch {
          // Transient poll failure, keep trying
        }
      }, 800);
    } catch (err) {
      setGenerating(false);
      setActiveQueryId(null);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? {
                ...m,
                content: extractErrorMessage(err),
                error: extractErrorMessage(err),
                status: 'failed' as const,
              }
            : m,
        ),
      );
    }
  }, [input, generating, credentialId, dbType, buildConversationHistory]);

  const handleCancel = useCallback(() => {
    if (activeQueryId) {
      cancelNlQuery(activeQueryId).catch(() => {});
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = undefined;
      }
      setActiveQueryId(null);
      setGenerating(false);
      setMessages((prev) =>
        prev.map((m) =>
          m.status === 'generating'
            ? { ...m, content: 'Cancelled.', status: 'failed' as const }
            : m,
        ),
      );
    }
  }, [activeQueryId]);

  const handleExecuteSql = useCallback(async (msgId: string, sql: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, status: 'executing' as const } : m)),
    );

    try {
      const result = await executeDbQuery(credentialId, sql);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, result, status: 'done' as const } : m,
        ),
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, error: extractErrorMessage(err), status: 'done' as const }
            : m,
        ),
      );
    }
  }, [credentialId, executeDbQuery]);

  const handleCopySql = useCallback((sql: string, msgId: string) => {
    navigator.clipboard.writeText(sql).catch(() => {});
    setCopiedSql(msgId);
    clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedSql(null), 1500);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const suggestions = getSuggestions(language);

  return (
    <div className="flex flex-col h-full min-h-[500px]">
      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-violet-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground/80">Ask in plain English</p>
              <p className="text-sm text-muted-foreground/50 mt-1 max-w-md">
                Describe what you want to query and I'll generate the {language === 'sql' ? 'SQL' : language} for you.
                You can review, edit, and execute the generated query.
              </p>
            </div>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2 max-w-lg justify-center mt-2">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => { setInput(s); inputRef.current?.focus(); }}
                    className="px-3 py-1.5 rounded-xl text-sm text-muted-foreground/60 bg-secondary/30 border border-primary/10 hover:bg-secondary/50 hover:text-muted-foreground/80 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-violet-500/10 border border-violet-500/15 text-foreground/85'
                  : 'bg-secondary/30 border border-primary/10 text-foreground/80'
              }`}
            >
              {/* User message */}
              {msg.role === 'user' && (
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              )}

              {/* Assistant: generating */}
              {msg.role === 'assistant' && msg.status === 'generating' && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground/60">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Generating query...</span>
                  <button
                    onClick={handleCancel}
                    className="ml-2 p-1 rounded-lg hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 transition-colors"
                    title="Cancel"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Assistant: failed */}
              {msg.role === 'assistant' && msg.status === 'failed' && (
                <p className="text-sm text-red-400">{msg.content}</p>
              )}

              {/* Assistant: has SQL (ready / executing / done) */}
              {msg.role === 'assistant' && msg.sql && msg.status !== 'generating' && msg.status !== 'failed' && (
                <div className="space-y-3">
                  {msg.explanation && (
                    <p className="text-sm text-foreground/70">{msg.explanation}</p>
                  )}

                  {/* SQL block */}
                  <div className="rounded-xl border border-primary/10 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-secondary/40 border-b border-primary/10">
                      <span className="text-xs font-medium text-muted-foreground/50 uppercase tracking-wide">
                        Generated {language === 'sql' ? 'SQL' : language}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleCopySql(msg.sql!, msg.id)}
                          className="p-1 rounded hover:bg-secondary/50 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
                          title="Copy SQL"
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
                        value={msg.sql}
                        onChange={(newSql) => {
                          setMessages((prev) =>
                            prev.map((m) => (m.id === msg.id ? { ...m, sql: newSql } : m)),
                          );
                        }}
                        language={language}
                        minHeight="60px"
                      />
                    </div>
                  </div>

                  {/* Execute button */}
                  {(msg.status === 'ready' || msg.status === 'done') && (
                    <button
                      onClick={() => handleExecuteSql(msg.id, msg.sql!)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
                    >
                      <Play className="w-3 h-3" />
                      {msg.result ? 'Re-run Query' : 'Run Query'}
                    </button>
                  )}

                  {msg.status === 'executing' && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground/60">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Executing...</span>
                    </div>
                  )}

                  {/* Execution error */}
                  {msg.error && msg.status === 'done' && (
                    <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 whitespace-pre-wrap font-mono">
                      {msg.error}
                    </div>
                  )}

                  {/* Results table */}
                  {msg.result && (
                    <QueryResultTable result={msg.result} />
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Input area */}
      <div className="shrink-0 border-t border-primary/10 px-4 py-3 bg-secondary/10">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                messages.length === 0
                  ? 'e.g. "Show me all users who signed up last week"'
                  : 'Ask a follow-up question...'
              }
              disabled={generating}
              rows={1}
              className="w-full resize-none rounded-xl border border-primary/15 bg-background px-4 py-2.5 pr-10 text-sm text-foreground/85 placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-violet-500/30 focus:border-violet-500/30 disabled:opacity-50 transition-colors"
              style={{ minHeight: '42px', maxHeight: '120px' }}
              onInput={(e) => {
                const ta = e.currentTarget;
                ta.style.height = 'auto';
                ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
              }}
            />
            <div className="absolute right-2 bottom-2 flex items-center gap-1 text-muted-foreground/30">
              <CornerDownLeft className="w-3 h-3" />
            </div>
          </div>
          <button
            onClick={generating ? handleCancel : handleSubmit}
            disabled={!generating && !input.trim()}
            className={`shrink-0 p-2.5 rounded-xl border transition-colors ${
              generating
                ? 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'
                : 'bg-violet-500/10 border-violet-500/20 text-violet-400 hover:bg-violet-500/20 disabled:opacity-30 disabled:cursor-not-allowed'
            }`}
            title={generating ? 'Cancel' : 'Send'}
          >
            {generating ? <X className="w-4 h-4" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function getDatabaseType(serviceType: string): string {
  switch (serviceType) {
    case 'supabase':
    case 'neon':
      return 'postgresql';
    case 'planetscale':
      return 'mysql';
    case 'upstash':
    case 'redis':
      return 'redis';
    default:
      return 'sql';
  }
}

function getSuggestions(language: string): string[] {
  if (language === 'redis') {
    return [
      'Show all keys matching "user:*"',
      'Get the 10 most recent entries',
    ];
  }
  return [
    'Show me all tables and their row counts',
    'Find the 10 most recent records',
    'List columns with null values',
    'Show duplicate entries',
  ];
}
