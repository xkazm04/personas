import { forwardRef } from 'react';
import {
  Bot,
  User,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';
import type { ChatMessage } from '@/lib/bindings/ChatMessage';

interface ChatThreadProps {
  messages: ChatMessage[];
  isThinking: boolean;
  thinkingLabel: string;
  error: string | null;
}

export const ChatThread = forwardRef<HTMLDivElement, ChatThreadProps>(
  function ChatThread({ messages, isThinking, thinkingLabel, error }, ref) {
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
              <p className="text-sm text-foreground/80">
                {t.agents.chat_thread.welcome}
              </p>
              <p className="text-sm text-muted-foreground/80">
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
                <User className="w-3.5 h-3.5 text-muted-foreground/60" />
              </div>
            ) : (
              <div className="w-7 h-7 rounded-card bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-primary/60" />
              </div>
            )}
            <p className="text-sm text-foreground/80 whitespace-pre-wrap pt-1 min-w-0">
              {msg.content}
            </p>
          </div>
        ))}

        {/* Thinking indicator */}
        {isThinking && (
          <div className="animate-fade-slide-in flex items-start gap-3">
            <div className="w-7 h-7 rounded-card bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="w-3.5 h-3.5 text-primary/60" />
            </div>
            <div className="flex items-center gap-2 pt-1.5">
              <LoadingSpinner size="sm" className="text-primary/50" />
              <span className="text-sm text-muted-foreground/60">{thinkingLabel}</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-sm text-red-400 px-10">{error}</p>
        )}
      </div>
    );
  },
);
