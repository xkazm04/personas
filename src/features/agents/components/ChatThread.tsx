import { forwardRef } from 'react';
import {
  Bot,
  User,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ChatMessage } from '@/lib/bindings/ChatMessage';
import { ChatMessageContent } from './ChatMessageContent';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';

interface ChatThreadProps {
  messages: ChatMessage[];
  isThinking: boolean;
  thinkingLabel: string;
  error: string | null;
  streamingMessageId?: string | null;
  onSendToLab?: (code: string, language?: string) => void;
  /**
   * Resend the last turn. When provided, the error card surfaces a Retry
   * button wired to this handler so the user can recover without re-typing.
   */
  onRetry?: () => void;
}

export const ChatThread = forwardRef<HTMLDivElement, ChatThreadProps>(
  function ChatThread(
    { messages, isThinking, thinkingLabel, error, streamingMessageId, onSendToLab, onRetry },
    ref,
  ) {
    const { t } = useTranslation();
    return (
      <div ref={ref} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Welcome message */}
        {messages.length === 0 && (
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-card bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="w-3.5 h-3.5 text-primary/60" />
            </div>
            <div className="space-y-1.5">
              <p className="typo-body text-foreground">
                {t.agents.chat_thread.welcome}
              </p>
              <p className="typo-body text-foreground">
                {t.agents.chat_thread.welcome_example}
              </p>
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className="animate-fade-slide-in flex items-start gap-3"
          >
            {msg.role === 'user' ? (
              <div className="w-7 h-7 rounded-card bg-secondary/50 border border-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <User className="w-3.5 h-3.5 text-foreground" />
              </div>
            ) : (
              <div className="w-7 h-7 rounded-card bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-primary/60" />
              </div>
            )}
            {msg.role === 'user' ? (
              <p className="typo-body text-foreground whitespace-pre-wrap pt-1 min-w-0">
                {msg.content}
              </p>
            ) : (
              <div className="pt-0.5 min-w-0 flex-1">
                <ChatMessageContent
                  content={msg.content}
                  streaming={streamingMessageId === msg.id}
                  onSendToLab={onSendToLab}
                />
              </div>
            )}
          </div>
        ))}

        {/* Thinking indicator */}
        {isThinking && (
          <div className="animate-fade-slide-in flex items-start gap-3">
            <div className="w-7 h-7 rounded-card bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="w-3.5 h-3.5 text-primary/60" />
            </div>
            <div className="flex items-center gap-2 pt-1.5">
              <span className="flex items-center gap-1" aria-hidden="true">
                <span className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-primary/50 animate-bounce" />
              </span>
              <span className="typo-body text-foreground">{thinkingLabel}</span>
            </div>
          </div>
        )}

        {/* Error — bordered status card aligned under the message column,
            with a Retry affordance that resends the last turn. */}
        {error && (
          <div className="pl-10">
            <InlineErrorBanner
              severity="error"
              message={error}
              onRetry={onRetry}
              compact
            />
          </div>
        )}
      </div>
    );
  },
);
