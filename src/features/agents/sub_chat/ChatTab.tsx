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

// Hysteresis: autoscroll is sticky (triggers when already close to bottom),
// but the scroll-to-bottom button only appears after the user has clearly
// scrolled away. The asymmetry prevents the button from flickering at the
// autoscroll boundary — do NOT unify these into one constant.
const NEAR_BOTTOM_AUTOSCROLL_PX = 120;
const SHOW_SCROLL_BTN_PX = 200;

// ── Main Chat Tab ───────────────────────────────────────────────────────

export function ChatTab() {
  const { t, tx } = useTranslation();
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const messages = useAgentStore((s) => s.chatMessages);
  const activeChatSessionId = useAgentStore((s) => s.activeChatSessionId);
  const chatStreaming = useAgentStore((s) => s.chatStreaming);
  const isExecuting = useAgentStore((s) => s.isExecuting);
  const activeExecutionId = useAgentStore((s) => s.activeExecutionId);
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
    // Use the explicit preloaded flag set by upstream callers (drawer /
    // notifications) that hydrated a specific session. Consuming it here
    // atomically marks it handled so a subsequent remount falls back to
    // the default restore behavior.
    const wasPreloaded = useAgentStore.getState().consumeChatPreloaded();
    if (!wasPreloaded) {
      restoreSession(personaId);
    }
  }, [personaId, fetchSessions, restoreSession]);

  // Auto-scroll to bottom on new messages (only if already near bottom)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < NEAR_BOTTOM_AUTOSCROLL_PX;
    if (isNearBottom) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamTextLines]);

  // Track scroll position for scroll-to-bottom button
  const handleScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setShowScrollBtn(distanceFromBottom > SHOW_SCROLL_BTN_PX);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  // Auto-focus input when presets disappear (message sent)
  useEffect(() => {
    if (messages.length > 0 && !chatStreaming) inputRef.current?.focus();
  }, [messages.length, chatStreaming]);

  // Recovery for stuck chatStreaming. Terminal events can be dropped (Tauri
  // event bridge hiccup, engine panic, sleep/resume) and leave chatStreaming
  // stuck true forever — locking the input. Two guards:
  //   1. Explicit clear when activeExecutionId transitions to null.
  //   2. 60s idle watchdog on streamTextLines growth while chatStreaming.
  useEffect(() => {
    if (chatStreaming && !activeExecutionId) {
      useAgentStore.setState({ chatStreaming: false, isExecuting: false });
    }
  }, [chatStreaming, activeExecutionId]);

  useEffect(() => {
    if (!chatStreaming) return;
    const STREAM_IDLE_TIMEOUT_MS = 60_000;
    const timer = window.setTimeout(() => {
      useAgentStore.setState({
        chatStreaming: false,
        isExecuting: false,
        activeExecutionId: null,
        executionPersonaId: null,
      });
    }, STREAM_IDLE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [chatStreaming, streamTextLines.length]);

  const handleCancelStream = useCallback(() => {
    useAgentStore.setState({
      chatStreaming: false,
      isExecuting: false,
      activeExecutionId: null,
      executionPersonaId: null,
    });
  }, []);

  const handleSend = useCallback(async (directPrompt?: string) => {
    const text = (directPrompt ?? inputValue).trim();
    if (!text || chatStreaming || isExecuting) return;
    // Snapshot the personaId at entry. If the user switches personas during
    // the async startNewSession await, we must NOT attach messages to the
    // newly-selected persona — that would leak content across histories.
    const sendPersonaId = personaId;
    let sessionId = activeChatSessionId;
    if (!sessionId) {
      sessionId = await startNewSession(sendPersonaId);
      if (!sessionId) return;
      // Guard: bail if the user navigated away to a different persona while
      // the session was being created. The session still exists for the
      // original persona — just don't post this user message into it
      // against a stale selection.
      const currentPersonaId = useAgentStore.getState().selectedPersona?.id ?? '';
      if (currentPersonaId !== sendPersonaId) return;
    }
    setInputValue('');
    sendMessage(sendPersonaId, sessionId, text);
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
            <div className="max-w-3xl mx-auto px-6 py-4">
              {messages.map((msg, i) => {
                const prev = messages[i - 1];
                const isGroupStart = !prev || prev.role !== msg.role;
                const spacing = i === 0 ? '' : isGroupStart ? 'mt-4' : 'mt-1';
                return (
                  <div key={msg.id} className={spacing}>
                    <ChatBubble message={msg} isGroupStart={isGroupStart} />
                  </div>
                );
              })}
              {chatStreaming && (
                <div className={messages[messages.length - 1]?.role === 'assistant' ? 'mt-1' : 'mt-4'}>
                  <StreamingBubble textLines={streamTextLines} />
                </div>
              )}
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
            <div className="max-w-3xl mx-auto flex items-center gap-2 typo-caption text-violet-400/70">
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
              {chatStreaming ? (
                <button
                  data-testid="chat-cancel-btn"
                  onClick={handleCancelStream}
                  className="flex-shrink-0 h-10 px-3 rounded-modal border border-primary/15 text-foreground typo-body-sm hover:bg-secondary/40 transition-colors"
                  title={t.agents.chat.cancel_stream}
                >
                  {t.agents.chat.cancel_stream}
                </button>
              ) : null}
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
