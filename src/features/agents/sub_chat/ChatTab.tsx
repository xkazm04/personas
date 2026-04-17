import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Send, ArrowDown, FlaskConical } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useAgentStore } from '@/stores/agentStore';
import { useExecutionStream } from '@/hooks/execution/useExecutionStream';
import { ChatBubble, StreamingBubble } from './ChatBubbles';
import { OpsSidebar, type OpsBadges } from './OpsSidebar';
import { AdvisoryLaunchpad } from './AdvisoryLaunchpad';
import { useExperimentBridge } from './hooks/useExperimentBridge';
import { useTranslation } from '@/i18n/useTranslation';

// ── Main Chat Tab ───────────────────────────────────────────────────────

export function ChatTab() {
  const { t, tx } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const messages = useAgentStore((s) => s.chatMessages);
  const activeChatSessionId = useAgentStore((s) => s.activeChatSessionId);
  const chatStreaming = useAgentStore((s) => s.chatStreaming);
  const isExecuting = useAgentStore((s) => s.isExecuting);
  const fetchSessions = useAgentStore((s) => s.fetchChatSessions);
  const restoreSession = useAgentStore((s) => s.restoreChatSession);
  const startNewSession = useAgentStore((s) => s.startNewChatSession);
  const sendMessage = useAgentStore((s) => s.sendChatMessage);

  const [inputValue, setInputValue] = useState('');
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const personaId = selectedPersona?.id ?? '';
  const { textLines: streamTextLines } = useExecutionStream(personaId);
  const { pendingExperiments } = useExperimentBridge();
  const healthDigest = useAgentStore((s) => s.healthDigest);

  // Compute badges for the ops sidebar icon rail
  const opsBadges = useMemo((): OpsBadges => {
    const personaHealth = healthDigest?.personas.find((p) => p.personaId === personaId);
    const unresolvedIssues = personaHealth?.result.issues?.filter((i) => !i.resolved) ?? [];
    return {
      run: { active: isExecuting },
      health: { issueCount: unresolvedIssues.length },
    };
  }, [isExecuting, healthDigest, personaId]);

  // Restore session on mount. Skip the restore if a specific session has
  // already been populated by an upstream caller (e.g. ProcessActivityDrawer
  // or the TitleBar notification-center click handler restoring a feedback
  // chat). fetchSessions still runs so the sidebar session list is accurate.
  useEffect(() => {
    if (!personaId) return;
    fetchSessions(personaId);
    const current = useAgentStore.getState();
    const hasPreloadedSession = !!current.activeChatSessionId && current.chatMessages.length > 0;
    if (!hasPreloadedSession) {
      restoreSession(personaId);
    }
  }, [personaId, fetchSessions, restoreSession]);

  // Auto-scroll to bottom on new messages (only if already near bottom)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    if (isNearBottom) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamTextLines]);

  // Track scroll position for scroll-to-bottom button
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollBtn(distanceFromBottom > 200);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Auto-focus input when presets disappear (message sent)
  useEffect(() => {
    if (messages.length > 0 && !chatStreaming) inputRef.current?.focus();
  }, [messages.length, chatStreaming]);

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

  const handleNewSession = useCallback(async () => {
    if (personaId) {
      useAgentStore.setState({
        chatMessages: [], activeChatSessionId: null, chatSessionContext: null,
        chatStreaming: false, isExecuting: false, activeExecutionId: null, executionPersonaId: null,
      });
      await startNewSession(personaId);
    }
  }, [personaId, startNewSession]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void handleSend(); }
  };

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-12 text-foreground typo-body">
        {t.agents.chat.select_persona}
      </div>
    );
  }

  const showPresets = messages.length === 0 && !chatStreaming;

  return (
    <div className="flex h-[calc(100vh-200px)] min-h-[400px] rounded-modal border border-primary/[0.08] overflow-hidden bg-background" data-testid="chat-tab">
      <OpsSidebar personaId={personaId} onNewSession={handleNewSession} badges={opsBadges} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages area */}
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto scroll-smooth"
          data-testid="chat-messages"
        >
          {showPresets ? (
            <AdvisoryLaunchpad personaName={selectedPersona.name} onSend={(p) => { void handleSend(p); }} />
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-4 space-y-5">
              {messages.map((msg) => <ChatBubble key={msg.id} message={msg} />)}
              {chatStreaming && <StreamingBubble textLines={streamTextLines} />}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Scroll-to-bottom button */}
        {showScrollBtn && !showPresets && (
          <div className="relative">
            <button
              onClick={scrollToBottom}
              className="absolute -top-12 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-background border border-primary/15 shadow-elevation-2 flex items-center justify-center text-foreground hover:text-foreground hover:border-primary/25 transition-all z-10"
              title={t.agents.chat.scroll_to_bottom}
            >
              <ArrowDown className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Pending experiments indicator */}
        {pendingExperiments.length > 0 && (
          <div className="border-t border-violet-500/15 bg-violet-500/5 px-6 py-2" data-testid="chat-experiments-pending">
            <div className="max-w-3xl mx-auto flex items-center gap-2 text-xs text-violet-400/70">
              <FlaskConical className="w-3.5 h-3.5 animate-pulse" />
              <span>{tx(pendingExperiments.length === 1 ? t.agents.chat.experiments_running_one : t.agents.chat.experiments_running_other, { count: pendingExperiments.length })}</span>
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="border-t border-primary/[0.08] bg-secondary/[0.03]" data-testid="chat-input-area">
          <div className="max-w-3xl mx-auto px-6 py-3">
            <div className="flex gap-2 items-end">
              <textarea
                ref={inputRef}
                data-testid="chat-input"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={chatStreaming ? t.agents.chat.waiting : t.agents.chat.ask_anything}
                disabled={chatStreaming || isExecuting}
                rows={1}
                className="flex-1 resize-none rounded-modal border border-primary/10 bg-background px-4 py-3 text-[15px] text-foreground placeholder:text-foreground focus-ring focus-visible:border-primary/20 disabled:opacity-50 min-h-[44px] max-h-[160px] transition-colors"
                style={{ height: 'auto', overflow: 'auto' }}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
                }}
              />
              <button
                data-testid="chat-send-btn"
                onClick={() => void handleSend()}
                disabled={!inputValue.trim() || chatStreaming || isExecuting}
                className="flex-shrink-0 w-10 h-10 rounded-modal bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {chatStreaming ? <LoadingSpinner /> : <Send className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-foreground mt-1.5 text-center select-none">
              {t.agents.chat.enter_to_send}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
