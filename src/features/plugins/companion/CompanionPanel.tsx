import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, RotateCcw, Send, X } from 'lucide-react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useCompanionStore } from './companionStore';
import {
  COMPANION_STREAM_EVENT,
  companionListRecentMessages,
  companionResetConversation,
  companionSendMessage,
  type CompanionStreamEvent,
} from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';

/**
 * Athena's chat panel — Phase 1: real chat over a long-lived Claude CLI
 * session. Composer + transcript + streaming bubble. Subscribes to
 * `companion://stream` Tauri events and accumulates assistant text live.
 */
export default function CompanionPanel() {
  const { t } = useTranslation();
  const state = useCompanionStore((s) => s.state);
  const setState = useCompanionStore((s) => s.setState);
  const initialized = useCompanionStore((s) => s.initialized);
  const initError = useCompanionStore((s) => s.initError);

  const messages = useCompanionStore((s) => s.messages);
  const streaming = useCompanionStore((s) => s.streaming);
  const streamingText = useCompanionStore((s) => s.streamingText);
  const sendError = useCompanionStore((s) => s.sendError);

  const setMessages = useCompanionStore((s) => s.setMessages);
  const appendMessage = useCompanionStore((s) => s.appendMessage);
  const setStreaming = useCompanionStore((s) => s.setStreaming);
  const appendStreamingText = useCompanionStore((s) => s.appendStreamingText);
  const resetStreamingText = useCompanionStore((s) => s.resetStreamingText);
  const setSendError = useCompanionStore((s) => s.setSendError);

  const isOpen = state === 'open';

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="companion-panel"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="fixed bottom-12 left-4 z-[60] w-[760px] h-[900px] max-h-[calc(100vh-5rem)] flex flex-col rounded-card bg-secondary/95 backdrop-blur-md border border-foreground/10 shadow-elevation-4 overflow-hidden"
          role="dialog"
          aria-label={t.plugins.companion.panel_label}
        >
          <Header
            onClose={() => setState('collapsed')}
            onReset={async () => {
              try {
                await companionResetConversation(false);
                const fresh = await companionListRecentMessages(50);
                setMessages(fresh);
              } catch (err: unknown) {
                silentCatch('companion_reset_conversation')(err);
              }
            }}
          />
          <Body
            initialized={initialized}
            initError={initError}
            messages={messages}
            streaming={streaming}
            streamingText={streamingText}
            sendError={sendError}
            setMessages={setMessages}
            appendMessage={appendMessage}
            setStreaming={setStreaming}
            appendStreamingText={appendStreamingText}
            resetStreamingText={resetStreamingText}
            setSendError={setSendError}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Header({
  onClose,
  onReset,
}: {
  onClose: () => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-foreground/10 shrink-0">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="inline-flex w-7 h-7 items-center justify-center rounded-full bg-primary/15 text-primary"
          aria-hidden
        >
          <Bot className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0">
          <div className="typo-body font-medium leading-tight truncate">
            {t.plugins.companion.name}
          </div>
          <div className="typo-caption text-foreground/60 leading-tight truncate">
            {t.plugins.companion.role}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onReset}
          className="p-1.5 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-foreground/5 transition-colors focus-ring"
          aria-label={t.plugins.companion.reset}
          title={t.plugins.companion.reset}
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          onClick={onClose}
          className="p-1.5 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-foreground/5 transition-colors focus-ring"
          aria-label={t.common.close}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}

interface BodyProps {
  initialized: boolean;
  initError: string | null;
  messages: ReturnType<typeof useCompanionStore.getState>['messages'];
  streaming: boolean;
  streamingText: string;
  sendError: string | null;
  setMessages: (m: BodyProps['messages']) => void;
  appendMessage: (m: BodyProps['messages'][number]) => void;
  setStreaming: (v: boolean) => void;
  appendStreamingText: (s: string) => void;
  resetStreamingText: () => void;
  setSendError: (e: string | null) => void;
}

function Body(props: BodyProps) {
  const {
    initialized,
    initError,
    messages,
    streaming,
    streamingText,
    sendError,
    setMessages,
    appendMessage,
    setStreaming,
    appendStreamingText,
    resetStreamingText,
    setSendError,
  } = props;
  const { t } = useTranslation();

  // Initial transcript fetch — once init is done.
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (!initialized || fetchedRef.current) return;
    fetchedRef.current = true;
    companionListRecentMessages(50)
      .then((msgs) => setMessages(msgs))
      .catch(silentCatch('companion_list_recent_messages'));
  }, [initialized, setMessages]);

  // Subscribe to streaming events from the backend.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;
    listen<CompanionStreamEvent>(COMPANION_STREAM_EVENT, (event) => {
      if (cancelled) return;
      const ev = event.payload;
      if (ev.kind === 'cli') {
        // Try to extract assistant text deltas from stream-json.
        const text = extractAssistantText(ev.payload);
        if (text) appendStreamingText(text);
      } else if (ev.kind === 'error') {
        setSendError(ev.payload);
      }
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(silentCatch('companion_stream_listen'));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [appendStreamingText, setSendError]);

  // Auto-scroll on new content.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, streaming]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setSendError(null);
      // Optimistic user bubble.
      const optimistic = {
        id: `optim_${Date.now()}`,
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      appendMessage(optimistic);
      setStreaming(true);
      resetStreamingText();
      try {
        await companionSendMessage(trimmed);
        // Refresh canonical transcript from backend (replaces the optimistic
        // user bubble with the persisted episode + adds the assistant turn).
        const fresh = await companionListRecentMessages(50);
        setMessages(fresh);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setSendError(msg);
        silentCatch('companion_send_message')(err);
      } finally {
        setStreaming(false);
        resetStreamingText();
      }
    },
    [appendMessage, resetStreamingText, setMessages, setSendError, setStreaming],
  );

  return (
    <>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-5 space-y-3">
        {!initialized && !initError && (
          <div className="flex items-center gap-3 text-foreground/70 typo-body">
            <LoadingSpinner size="sm" />
            <span>{t.plugins.companion.initializing}</span>
          </div>
        )}
        {initError && (
          <div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-3 py-2 typo-body text-rose-400">
            {t.plugins.companion.init_failed}: {initError}
          </div>
        )}
        {initialized && messages.length === 0 && !streaming && (
          <p className="typo-body text-foreground/50">
            {t.plugins.companion.empty_transcript}
          </p>
        )}
        {messages.map((m) => (
          <Bubble key={m.id} role={m.role}>
            {m.content}
          </Bubble>
        ))}
        {streaming && (
          <Bubble role="assistant" streaming>
            {streamingText || t.plugins.companion.thinking}
          </Bubble>
        )}
        {sendError && (
          <div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-3 py-2 typo-caption text-rose-400">
            {sendError}
          </div>
        )}
      </div>
      <Composer disabled={!initialized || streaming} onSend={send} />
    </>
  );
}

function Bubble({
  role,
  streaming,
  children,
}: {
  role: string;
  streaming?: boolean;
  children: React.ReactNode;
}) {
  const isUser = role === 'user';
  // User messages render as plain text (typically no markdown). Assistant
  // messages render through MarkdownRenderer so headings, lists, code, and
  // emphasis show properly. Streaming text also renders as markdown so
  // partial content looks right as it grows.
  const isString = typeof children === 'string';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-card px-3.5 py-2.5 typo-body break-words ${
          isUser
            ? 'bg-primary/15 text-foreground whitespace-pre-wrap'
            : 'bg-foreground/5 text-foreground'
        } ${streaming ? 'opacity-90' : ''}`}
      >
        {isUser || !isString ? (
          children
        ) : (
          <MarkdownRenderer content={children as string} />
        )}
      </div>
    </div>
  );
}

function Composer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(() => {
    if (disabled || !draft.trim()) return;
    onSend(draft);
    setDraft('');
  }, [disabled, draft, onSend]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  // Auto-grow up to ~6 lines.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const placeholder = useMemo(
    () => t.plugins.companion.composer_placeholder,
    [t.plugins.companion.composer_placeholder],
  );

  return (
    <div className="border-t border-foreground/10 px-3 py-3 shrink-0">
      <div className="flex items-end gap-2 rounded-card bg-foreground/5 px-3 py-2">
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 bg-transparent border-0 outline-none resize-none typo-body text-foreground placeholder:text-foreground/40 disabled:opacity-50"
          aria-label={placeholder}
        />
        <button
          onClick={submit}
          disabled={disabled || !draft.trim()}
          className="p-2 rounded-interactive bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity focus-ring"
          aria-label={t.plugins.companion.send}
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Best-effort extraction of assistant text from a stream-json line. Claude
 * Code emits multiple line types; we only care about assistant content
 * blocks of type `text`. Anything we can't parse is silently skipped (the
 * raw line is still useful as a "thinking" indicator at the panel level).
 */
function extractAssistantText(line: string): string {
  try {
    const json = JSON.parse(line);
    if (json?.type !== 'assistant') return '';
    const blocks = json?.message?.content;
    if (!Array.isArray(blocks)) return '';
    let out = '';
    for (const b of blocks) {
      if (b?.type === 'text' && typeof b.text === 'string') {
        out += b.text;
      }
    }
    return out;
  } catch {
    return '';
  }
}
