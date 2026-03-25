import { Bot, User } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
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

export function StreamingBubble({ textLines }: { textLines: string[] }) {
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
