import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Bot, Wrench } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useAgentStore } from '@/stores/agentStore';
import { useExecutionStream } from '@/hooks/execution/useExecutionStream';
import { ChatBubble, StreamingBubble } from './ChatBubbles';
import { SessionSidebar } from './SessionSidebar';
import { OpsLaunchpad, ModeButton } from './OpsLaunchpad';
import { ROW_SEPARATOR } from '@/lib/design/listTokens';

// ── Main Chat Tab ───────────────────────────────────────────────────────

export function ChatTab() {
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const messages = useAgentStore((s) => s.chatMessages);
  const activeChatSessionId = useAgentStore((s) => s.activeChatSessionId);
  const chatStreaming = useAgentStore((s) => s.chatStreaming);
  const isExecuting = useAgentStore((s) => s.isExecuting);
  const chatMode = useAgentStore((s) => s.chatMode);
  const setChatMode = useAgentStore((s) => s.setChatMode);
  const fetchSessions = useAgentStore((s) => s.fetchChatSessions);
  const restoreSession = useAgentStore((s) => s.restoreChatSession);
  const startNewSession = useAgentStore((s) => s.startNewChatSession);
  const sendMessage = useAgentStore((s) => s.sendChatMessage);

  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const personaId = selectedPersona?.id ?? '';

  // Shared execution stream — replaces local streamLines state + sync/clear effects
  const { textLines: streamTextLines } = useExecutionStream(personaId);

  // Restore last session and fetch session list on mount
  useEffect(() => {
    if (personaId) {
      fetchSessions(personaId);
      restoreSession(personaId);
    }
  }, [personaId, fetchSessions, restoreSession]);

  // Auto-create a session if none active
  const handleNewSession = useCallback(async () => {
    if (personaId) await startNewSession(personaId);
  }, [personaId, startNewSession]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamTextLines]);

  const handleSend = useCallback(async (directPrompt?: string) => {
    const text = (directPrompt ?? inputValue).trim();
    if (!text || chatStreaming || isExecuting) return;
    let sessionId = activeChatSessionId;
    if (!sessionId) {
      sessionId = await startNewSession(personaId);
      if (!sessionId) return;
    }
    setInputValue('');
    sendMessage(personaId, sessionId, text);
  }, [inputValue, chatStreaming, isExecuting, activeChatSessionId, personaId, startNewSession, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  if (!selectedPersona) return null;

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[400px] rounded-lg border border-primary/10 overflow-hidden bg-background">
      {/* Session sidebar */}
      <SessionSidebar personaId={personaId} onNewSession={handleNewSession} />

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mode toggle */}
        <div className={`flex items-center gap-2 px-4 py-2 border-b ${ROW_SEPARATOR}`}>
          <div className="flex gap-0.5 p-0.5 bg-secondary/50 rounded-lg">
            <ModeButton mode="ops" current={chatMode} onClick={setChatMode} icon={<Wrench className="w-3 h-3" />} label="Ops" />
            <ModeButton mode="agent" current={chatMode} onClick={setChatMode} icon={<Bot className="w-3 h-3" />} label="Agent" />
          </div>
          <span className="text-sm text-muted-foreground/50">
            {chatMode === 'ops' ? 'Manage, test & improve this agent' : `Chat directly with ${selectedPersona.name}`}
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 && !chatStreaming && (
            chatMode === 'ops'
              ? <OpsLaunchpad
                  personaName={selectedPersona.name}
                  onSelect={(prompt) => { setInputValue(prompt); inputRef.current?.focus(); }}
                  onSend={(prompt) => { void handleSend(prompt); }}
                />
              : <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="w-6 h-6 text-primary/60" />
                  </div>
                  <div>
                    <p className="text-lg font-medium text-foreground/80">Chat with {selectedPersona.name}</p>
                    <p className="text-base text-muted-foreground/60 mt-1">Send a message to start a conversation with this agent.</p>
                  </div>
                </div>
          )}

          {messages.map((msg) => (
            <ChatBubble key={msg.id} message={msg} />
          ))}

          {chatStreaming && <StreamingBubble textLines={streamTextLines} />}

          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className={`border-t ${ROW_SEPARATOR} p-3`}>
          <div className="flex gap-2 items-end">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={chatStreaming ? 'Waiting for response...' : chatMode === 'ops' ? 'Ask about health, run tests, edit prompts...' : 'Type a message...'}
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
              onClick={() => void handleSend()}
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
