import { forwardRef } from 'react';
import { motion } from 'framer-motion';
import {
  Bot,
  Loader2,
  User,
} from 'lucide-react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface ChatThreadProps {
  messages: ChatMessage[];
  isThinking: boolean;
  thinkingLabel: string;
  error: string | null;
}

export const ChatThread = forwardRef<HTMLDivElement, ChatThreadProps>(
  function ChatThread({ messages, isThinking, thinkingLabel, error }, ref) {
    return (
      <div ref={ref} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Welcome message */}
        {messages.length === 0 && (
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="w-3.5 h-3.5 text-primary/60" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm text-foreground/80">
                Tell me what you need this agent to do. I'll build the full configuration — prompt, tools, triggers — from your description.
              </p>
              <p className="text-sm text-muted-foreground/80">
                Example: "Watch my GitHub PRs and post a summary to Slack every morning"
              </p>
            </div>
          </div>
        )}

        {/* Messages */}
        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="flex items-start gap-3"
          >
            {msg.role === 'user' ? (
              <div className="w-7 h-7 rounded-lg bg-secondary/50 border border-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <User className="w-3.5 h-3.5 text-muted-foreground/60" />
              </div>
            ) : (
              <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5 text-primary/60" />
              </div>
            )}
            <p className="text-sm text-foreground/80 whitespace-pre-wrap pt-1 min-w-0">
              {msg.content}
            </p>
          </motion.div>
        ))}

        {/* Thinking indicator */}
        {isThinking && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="w-3.5 h-3.5 text-primary/60" />
            </div>
            <div className="flex items-center gap-2 pt-1.5">
              <Loader2 className="w-3.5 h-3.5 text-primary/50 animate-spin" />
              <span className="text-sm text-muted-foreground/60">{thinkingLabel}</span>
            </div>
          </motion.div>
        )}

        {/* Error */}
        {error && (
          <p className="text-sm text-red-400 px-10">{error}</p>
        )}
      </div>
    );
  },
);
