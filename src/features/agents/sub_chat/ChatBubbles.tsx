import { Bot, User } from 'lucide-react';
import type { ChatMessage } from '@/lib/bindings/ChatMessage';

// ── Chat Bubble ──────────────────────────────────────────────────────────

export function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
        isUser ? 'bg-primary/15 text-primary' : 'bg-violet-500/15 text-violet-400'
      }`}>
        {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5" />}
      </div>
      <div className={`max-w-[75%] px-4 py-3 text-base leading-relaxed ${
        isUser
          ? 'bg-primary text-primary-foreground rounded-2xl rounded-br-md'
          : 'bg-muted/60 text-foreground border border-primary/10 rounded-xl rounded-tl-md'
      }`}>
        <span className={`block text-sm font-semibold mb-1 ${
          isUser ? 'text-primary-foreground/80' : 'text-violet-400'
        }`}>
          {isUser ? 'You' : 'Assistant'}
        </span>
        <p className="whitespace-pre-wrap break-words">{message.content}</p>
        <span className={`block text-xs tracking-wide mt-1.5 ${
          isUser ? 'text-primary-foreground/60' : 'text-muted-foreground/60'
        }`}>
          {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  );
}

// ── Streaming Bubble ────────────────────────────────────────────────────

export function StreamingBubble({ textLines }: { textLines: string[] }) {
  if (textLines.length === 0) {
    return (
      <div className="flex gap-2.5">
        <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-violet-500/15 text-violet-400 animate-avatar-breathe">
          <Bot className="w-3.5 h-3.5" />
        </div>
        <div className="bg-muted/60 border border-primary/10 rounded-xl rounded-tl-md px-4 py-3 flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="block w-1.5 h-1.5 rounded-full bg-violet-400 animate-typing-dot"
              style={{ animationDelay: `${i * 0.3}s` }}
            />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center bg-violet-500/15 text-violet-400">
        <Bot className="w-3.5 h-3.5" />
      </div>
      <div className="max-w-[75%] bg-muted/60 text-foreground border border-primary/10 rounded-xl rounded-tl-md px-4 py-3 text-base leading-relaxed">
        <span className="block text-sm font-semibold mb-1 text-violet-400">Assistant</span>
        <p className="whitespace-pre-wrap break-words">{textLines.join('\n')}</p>
      </div>
    </div>
  );
}
