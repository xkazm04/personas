import { useState, useCallback } from 'react';
import { Bot, User, Copy, Check } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import type { ChatMessage } from '@/lib/bindings/ChatMessage';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';

// Fallback copy via a hidden textarea + document.execCommand('copy'). Used
// when navigator.clipboard is unavailable (non-secure context, file://, some
// Tauri webview configs) or rejects (permission / document-not-focused).
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

// ── Copy Button ──────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const [copied, setCopied] = useState(false);
  const markCopied = useCallback(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);
  const handleCopy = useCallback(() => {
    const fail = () => {
      // Last resort: try the legacy path, then surface a toast if that
      // also fails so the user doesn't stare at an inert button.
      if (legacyCopy(text)) {
        markCopied();
        return;
      }
      addToast(t.agents.chat.copy_failed, 'error');
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(markCopied).catch(fail);
    } else {
      fail();
    }
  }, [text, markCopied, addToast, t.agents.chat.copy_failed]);
  return (
    <button
      onClick={handleCopy}
      className="opacity-0 group-hover/bubble:opacity-100 absolute top-2 right-2 p-1 rounded-input bg-background/80 backdrop-blur-sm border border-primary/10 text-foreground hover:text-foreground/80 transition-all"
      title={t.agents.chat.copy_message}
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ── Timestamp ────────────────────────────────────────────────────────────

function Timestamp({ date, className }: { date: string; className?: string }) {
  const d = new Date(date);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return <time className={`text-[11px] select-none ${className ?? ''}`} dateTime={d.toISOString()}>{time}</time>;
}

// ── Chat Bubble ──────────────────────────────────────────────────────────

export function ChatBubble({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const isUser = message.role === 'user';

  return (
    <div className={`group/msg flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`} data-testid={`chat-bubble-${message.role}`}>
      {/* Avatar */}
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5 ${
        isUser ? 'bg-primary/15' : 'bg-violet-500/12'
      }`}>
        {isUser
          ? <User className="w-4 h-4 text-primary" />
          : <Bot className="w-4 h-4 text-violet-400" />}
      </div>

      {/* Content */}
      <div className={`relative group/bubble min-w-0 ${isUser ? 'max-w-[70%]' : 'max-w-[85%]'}`}>
        {/* Name + timestamp row */}
        <div className={`flex items-baseline gap-2 mb-0.5 ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className={`text-[13px] font-semibold ${isUser ? 'text-foreground' : 'text-violet-400/90'}`}>
            {isUser ? t.agents.chat.you : t.agents.chat.assistant}
          </span>
          <Timestamp date={message.createdAt} className={isUser ? 'text-foreground' : 'text-foreground'} />
        </div>

        {/* Message body */}
        <div className={`relative rounded-2xl px-4 py-3 ${
          isUser
            ? 'chat-user-bubble rounded-tr-md'
            : 'bg-secondary/40 border border-primary/[0.07] rounded-tl-md'
        }`}>
          {isUser ? (
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap break-words">{message.content}</p>
          ) : (
            <AssistantContent content={message.content} />
          )}
          {!isUser && <CopyBtn text={message.content} />}
        </div>
      </div>
    </div>
  );
}

// ── Assistant Content Renderer ───────────────────────────────────────────

/** Filter out advisory operation JSON lines from displayed content. */
function stripOperationLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      // Filter JSON operation lines emitted by the advisory assistant
      return !t.startsWith('{"op"') && !t.startsWith('{"op":');
    })
    .join('\n')
    .trim();
}

function AssistantContent({ content }: { content: string }) {
  const cleaned = stripOperationLines(content);

  const { t } = useTranslation();
  if (!cleaned) return <p className="text-foreground italic">{t.agents.chat.processing}</p>;

  return (
    <div className="chat-markdown">
      <MarkdownRenderer content={cleaned} />
    </div>
  );
}

// ── Streaming Bubble ────────────────────────────────────────────────────

export function StreamingBubble({ textLines }: { textLines: string[] }) {
  const { t } = useTranslation();
  const cleanLines = textLines.filter((l) => {
    const t = l.trim();
    return !t.startsWith('{"op"') && !t.startsWith('{"op":');
  });
  const hasContent = cleanLines.some((l) => l.trim().length > 0);

  return (
    <div className="flex gap-3" data-testid="chat-bubble-streaming">
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5 bg-violet-500/12 ${
        !hasContent ? 'animate-pulse' : ''
      }`}>
        <Bot className="w-4 h-4 text-violet-400" />
      </div>
      <div className="min-w-0 max-w-[85%]">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-[13px] font-semibold text-violet-400/90">{t.agents.chat.assistant}</span>
          {!hasContent && <span className="text-[11px] text-foreground">{t.agents.chat.thinking}</span>}
        </div>
        <div className="rounded-2xl rounded-tl-md bg-secondary/40 border border-primary/[0.07] px-4 py-3">
          {hasContent ? (
            <div className="chat-markdown">
              <MarkdownRenderer content={cleanLines.join('\n')} />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 py-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="block w-2 h-2 rounded-full bg-violet-400/60 animate-typing-dot"
                  style={{ animationDelay: `${i * 0.2}s` }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
