import { useState } from 'react';
import { MessageSquare, Clock, Trash2, ChevronDown, ChevronRight, User, Bot, CheckCircle2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DesignConversation, DesignConversationMessage } from '@/lib/types/designTypes';
import { parseConversationMessages } from '@/lib/types/designTypes';

interface DesignConversationHistoryProps {
  conversations: DesignConversation[];
  activeConversationId: string | null;
  onResumeConversation: (conversation: DesignConversation) => void;
  onDeleteConversation: (id: string) => void;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function MessageBubble({ message }: { message: DesignConversationMessage }) {
  const isUser = message.role === 'user';
  const typeLabel = message.messageType
    ? message.messageType.charAt(0).toUpperCase() + message.messageType.slice(1)
    : isUser ? 'User' : 'AI';

  // Truncate long content (result JSON)
  const displayContent = message.content.length > 300
    ? message.content.slice(0, 297) + '...'
    : message.content;

  return (
    <div className={`flex gap-2 ${isUser ? '' : ''}`} data-testid={`conversation-message-${message.role}`}>
      <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
        isUser ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
      }`}>
        {isUser ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={`text-[10px] font-medium uppercase tracking-wide ${
            isUser ? 'text-blue-400/80' : 'text-purple-400/80'
          }`}>
            {typeLabel}
          </span>
          <span className="text-[10px] text-muted-foreground/50">
            {formatRelativeTime(message.timestamp)}
          </span>
        </div>
        <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">
          {displayContent}
        </p>
      </div>
    </div>
  );
}

function ConversationCard({
  conversation,
  isActive,
  onResume,
  onDelete,
}: {
  conversation: DesignConversation;
  isActive: boolean;
  onResume: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const messages = parseConversationMessages(conversation.messages);
  const messageCount = messages.length;
  const isCompleted = conversation.status === 'completed';

  return (
    <div
      className={`rounded-lg border transition-colors ${
        isActive
          ? 'border-blue-500/40 bg-blue-500/5'
          : 'border-border/50 bg-card/50 hover:border-border'
      }`}
      data-testid={`conversation-card-${conversation.id}`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 flex-1 min-w-0 text-left"
          data-testid={`conversation-expand-${conversation.id}`}
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          )}
          <MessageSquare className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-xs font-medium truncate">{conversation.title}</span>
          {isCompleted && (
            <CheckCircle2 className="w-3 h-3 text-green-400 flex-shrink-0" />
          )}
        </button>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground/60 tabular-nums">
            {messageCount} msg{messageCount !== 1 ? 's' : ''}
          </span>
          <span className="text-[10px] text-muted-foreground/40">·</span>
          <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5">
            <Clock className="w-2.5 h-2.5" />
            {formatRelativeTime(conversation.updatedAt)}
          </span>

          {!isActive && conversation.status === 'active' && (
            <button
              onClick={(e) => { e.stopPropagation(); onResume(); }}
              className="ml-1 px-2 py-0.5 text-[10px] font-medium rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors"
              data-testid={`conversation-resume-${conversation.id}`}
            >
              Resume
            </button>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="ml-0.5 p-0.5 text-muted-foreground/40 hover:text-red-400 transition-colors"
            data-testid={`conversation-delete-${conversation.id}`}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Expanded messages */}
      <AnimatePresence>
        {expanded && messages.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2.5 space-y-2 border-t border-border/30 pt-2">
              {messages.map((msg, i) => (
                <MessageBubble key={i} message={msg} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function DesignConversationHistory({
  conversations,
  activeConversationId,
  onResumeConversation,
  onDeleteConversation,
}: DesignConversationHistoryProps) {
  if (conversations.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1.5" data-testid="design-conversation-history">
      <div className="flex items-center gap-1.5 px-1">
        <MessageSquare className="w-3.5 h-3.5 text-muted-foreground/60" />
        <span className="text-[11px] font-medium text-muted-foreground/80 uppercase tracking-wide">
          Design Sessions
        </span>
        <span className="text-[10px] text-muted-foreground/50">({conversations.length})</span>
      </div>
      <div className="space-y-1">
        {conversations.map((conv) => (
          <ConversationCard
            key={conv.id}
            conversation={conv}
            isActive={conv.id === activeConversationId}
            onResume={() => onResumeConversation(conv)}
            onDelete={() => onDeleteConversation(conv.id)}
          />
        ))}
      </div>
    </div>
  );
}
