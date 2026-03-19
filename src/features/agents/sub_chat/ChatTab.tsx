import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Plus, Trash2, Bot, User } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useAgentStore } from "@/stores/agentStore";
import type { ChatMessage } from '@/lib/bindings/ChatMessage';
import { classifyLine } from '@/lib/utils/terminalColors';

// ── Chat Bubble ──────────────────────────────────────────────────────────

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
        isUser ? 'bg-primary/15 text-primary' : 'bg-violet-500/15 text-violet-400'
      }`}>
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>
      <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
        isUser
          ? 'bg-primary text-primary-foreground rounded-br-md'
          : 'bg-muted/60 text-foreground border border-primary/10 rounded-bl-md'
      }`}>
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <span className={`block text-[10px] mt-1 ${
          isUser ? 'text-primary-foreground/60' : 'text-muted-foreground/60'
        }`}>
          {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

// ── Streaming Bubble ────────────────────────────────────────────────────

function StreamingBubble({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  // Filter out non-text lines (system init, tool calls, etc.)
  const textLines = lines.filter((l) => {
    const cls = classifyLine(l);
    return cls === 'text';
  });
  if (textLines.length === 0) {
    return (
      <div className="flex gap-2.5">
        <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-violet-500/15 text-violet-400">
          <Bot className="w-3.5 h-3.5" />
        </div>
        <div className="bg-muted/60 border border-primary/10 rounded-2xl rounded-bl-md px-3.5 py-2.5">
          <LoadingSpinner className="text-muted-foreground" />
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-violet-500/15 text-violet-400">
        <Bot className="w-3.5 h-3.5" />
      </div>
      <div className="max-w-[75%] bg-muted/60 text-foreground border border-primary/10 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm leading-relaxed">
        <p className="whitespace-pre-wrap break-words">{textLines.join('\n')}</p>
      </div>
    </div>
  );
}

// ── Session List Sidebar ────────────────────────────────────────────────

function SessionSidebar({
  personaId,
  onNewSession,
}: {
  personaId: string;
  onNewSession: () => void;
}) {
  const sessions = useAgentStore((s) => s.chatSessions);
  const activeSessionId = useAgentStore((s) => s.activeChatSessionId);
  const fetchMessages = useAgentStore((s) => s.fetchChatMessages);
  const clearSession = useAgentStore((s) => s.clearChatSession);

  return (
    <div className="w-48 border-r border-primary/10 flex flex-col h-full">
      <div className="p-2 border-b border-primary/10">
        <button
          onClick={onNewSession}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> New Chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {sessions.length === 0 && (
          <p className="text-xs text-muted-foreground/60 text-center py-4 px-2">
            No conversations yet
          </p>
        )}
        {sessions.map((s) => (
          <div
            key={s.sessionId}
            className={`group flex items-center gap-1 px-2 py-1.5 mx-1 rounded-md cursor-pointer text-xs transition-colors ${
              activeSessionId === s.sessionId
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'
            }`}
            onClick={() => fetchMessages(personaId, s.sessionId)}
          >
            <span className="flex-1 truncate">
              {new Date(s.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
              {' '}
              {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            <span className="text-[10px] text-muted-foreground/50">{s.messageCount}</span>
            <button
              onClick={(e) => { e.stopPropagation(); clearSession(personaId, s.sessionId); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-opacity"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Chat Tab ───────────────────────────────────────────────────────

export function ChatTab() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const messages = useAgentStore((s) => s.chatMessages);
  const activeChatSessionId = useAgentStore((s) => s.activeChatSessionId);
  const chatStreaming = useAgentStore((s) => s.chatStreaming);
  const isExecuting = useAgentStore((s) => s.isExecuting);
  const executionOutput = useAgentStore((s) => s.executionOutput);
  const executionPersonaId = useAgentStore((s) => s.executionPersonaId);
  const fetchSessions = useAgentStore((s) => s.fetchChatSessions);
  const startNewSession = useAgentStore((s) => s.startNewChatSession);
  const sendMessage = useAgentStore((s) => s.sendChatMessage);

  const [inputValue, setInputValue] = useState('');
  const [streamLines, setStreamLines] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prevStreamingRef = useRef(false);

  const personaId = selectedPersona?.id ?? '';

  // Fetch sessions on mount
  useEffect(() => {
    if (personaId) fetchSessions(personaId);
  }, [personaId, fetchSessions]);

  // Auto-create a session if none active
  const handleNewSession = useCallback(async () => {
    if (personaId) await startNewSession(personaId);
    setStreamLines([]);
  }, [personaId, startNewSession]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamLines]);

  // Collect streaming output from execution while chatStreaming is active
  useEffect(() => {
    if (!chatStreaming || executionPersonaId !== personaId) return;
    setStreamLines(executionOutput);
  }, [chatStreaming, executionOutput, executionPersonaId, personaId]);

  // Clear local stream lines when chatStreaming ends.
  // The store's finishExecution/cancelExecution handle calling finishChatStream
  // so this works even if ChatTab was unmounted during the execution.
  useEffect(() => {
    if (prevStreamingRef.current && !chatStreaming) {
      setStreamLines([]);
    }
    prevStreamingRef.current = chatStreaming;
  }, [chatStreaming]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || chatStreaming || isExecuting) return;
    let sessionId = activeChatSessionId;
    if (!sessionId) {
      sessionId = await startNewSession(personaId);
      if (!sessionId) return; // session creation failed
    }
    setInputValue('');
    setStreamLines([]);
    sendMessage(personaId, sessionId, text);
  }, [inputValue, chatStreaming, isExecuting, activeChatSessionId, personaId, startNewSession, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!selectedPersona) return null;

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[400px] rounded-lg border border-primary/10 overflow-hidden bg-background">
      {/* Session sidebar */}
      <SessionSidebar personaId={personaId} onNewSession={handleNewSession} />

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !chatStreaming && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-3">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="w-6 h-6 text-primary/60" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground/80">Chat with {selectedPersona.name}</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Send a message to start a conversation with this agent.
                </p>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} />
          ))}

          {chatStreaming && <StreamingBubble lines={streamLines} />}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="border-t border-primary/10 p-3">
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={chatStreaming ? 'Waiting for response...' : 'Type a message...'}
              disabled={chatStreaming || isExecuting}
              rows={1}
              className="flex-1 resize-none rounded-xl border border-primary/15 bg-muted/30 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus-ring disabled:opacity-50 min-h-[40px] max-h-[120px]"
              style={{ height: 'auto', overflow: 'auto' }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                el.style.height = Math.min(el.scrollHeight, 120) + 'px';
              }}
            />
            <button
              onClick={handleSend}
              disabled={!inputValue.trim() || chatStreaming || isExecuting}
              className="flex-shrink-0 w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {chatStreaming ? (
                <LoadingSpinner />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
