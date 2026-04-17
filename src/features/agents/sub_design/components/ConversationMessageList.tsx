import { useState } from 'react';
import { MessageSquare, Clock, Trash2, ChevronDown, ChevronRight, User, Bot, CheckCircle2, X, ArrowRight, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DesignConversation, DesignConversationMessage } from '@/lib/types/designTypes';
import { parseConversationMessages } from '@/lib/types/designTypes';
import type { DesignDriftEvent } from '@/lib/design/designDrift';
import { DRIFT_KIND_META } from '@/lib/design/designDrift';
import { formatRelativeTime } from '@/lib/utils/formatters';

export function MessageBubble({ message }: { message: DesignConversationMessage }) {
  const isUser = message.role === 'user';
  const typeLabel = message.messageType
    ? message.messageType.charAt(0).toUpperCase() + message.messageType.slice(1)
    : isUser ? 'User' : 'AI';
  const displayContent = message.content.length > 300
    ? message.content.slice(0, 297) + '...'
    : message.content;

  return (
    <div className={`flex gap-2`} data-testid={`conversation-message-${message.role}`}>
      <div className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center ${
        isUser ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'
      }`}>
        {isUser ? <User className="w-3 h-3" /> : <Bot className="w-3 h-3" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={`text-sm font-medium uppercase tracking-wide ${isUser ? 'text-blue-400/80' : 'text-purple-400/80'}`}>{typeLabel}</span>
          <span className="text-sm text-muted-foreground/50">{formatRelativeTime(message.timestamp, '-', { dateFallbackDays: 7 })}</span>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">{displayContent}</p>
      </div>
    </div>
  );
}

export function ConversationCard({
  conversation, isActive, onResume, onDelete,
}: {
  conversation: DesignConversation; isActive: boolean; onResume: () => void; onDelete: () => void;
}) {
  const { t, tx } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const messages = parseConversationMessages(conversation.messages) ?? [];
  const messageCount = messages.length;
  const isCompleted = conversation.status === 'completed';

  return (
    <div className={`rounded-card border transition-colors ${isActive ? 'border-blue-500/40 bg-blue-500/5' : 'border-border/50 bg-card/50 hover:border-border'}`} data-testid={`conversation-card-${conversation.id}`}>
      <div className="flex items-center gap-2 px-3 py-2" role="group" aria-label="Design conversation controls">
        <button onClick={() => setExpanded(!expanded)} className="flex items-center gap-1.5 flex-1 min-w-0 text-left" data-testid={`conversation-expand-${conversation.id}`}>
          {expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
          <MessageSquare className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-sm font-medium truncate">{conversation.title}</span>
          {isCompleted && <CheckCircle2 className="w-3 h-3 text-green-400 flex-shrink-0" />}
        </button>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-sm text-muted-foreground/60 tabular-nums">{tx(messageCount === 1 ? t.agents.design.msg_count_one : t.agents.design.msg_count_other, { count: messageCount })}</span>
          <span className="text-sm text-muted-foreground/40">·</span>
          <span className="text-sm text-muted-foreground/60 flex items-center gap-0.5"><Clock className="w-2.5 h-2.5" />{formatRelativeTime(conversation.updatedAt, '-', { dateFallbackDays: 7 })}</span>
          {!isActive && conversation.status === 'active' && (
            <button onClick={(e) => { e.stopPropagation(); onResume(); }} className="ml-1 px-2 py-0.5 text-sm font-medium rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors" data-testid={`conversation-resume-${conversation.id}`}>{t.agents.design.resume}</button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="ml-0.5 p-0.5 text-muted-foreground/40 hover:text-red-400 transition-colors" data-testid={`conversation-delete-${conversation.id}`}><Trash2 className="w-3 h-3" /></button>
        </div>
      </div>
      {expanded && messages.length > 0 && (
          <div className="animate-fade-slide-in overflow-hidden">
            <div className="px-3 pb-2.5 space-y-2 border-t border-border/30 pt-2">
              {messages.map((msg, i) => <MessageBubble key={i} message={msg} />)}
            </div>
          </div>
        )}
    </div>
  );
}

export function DriftNotificationCard({ event, onDismiss }: { event: DesignDriftEvent; onDismiss: () => void }) {
  const { t } = useTranslation();
  const meta = DRIFT_KIND_META[event.kind];
  return (
    <div className={`animate-fade-slide-in group relative rounded-card border ${meta.borderClass} ${meta.bgClass} p-2.5 transition-colors`}>
      <button onClick={onDismiss} className="absolute top-1.5 right-1.5 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 text-muted-foreground/50 hover:text-foreground/70 transition-all" title={t.common.dismiss}><X className="w-2.5 h-2.5" /></button>
      <div className="flex items-start gap-2">
        <AlertTriangle className={`w-3.5 h-3.5 ${meta.textClass} flex-shrink-0 mt-0.5`} />
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className={`text-sm font-semibold ${meta.textClass}`}>{event.title}</span>
            <span className={`text-[10px] px-1 py-0.5 rounded ${meta.bgClass} ${meta.textClass} font-medium uppercase tracking-wider`}>{meta.label}</span>
          </div>
          <p className="text-sm text-foreground/70 line-clamp-2">{event.description}</p>
          <div className="flex items-center gap-1 pt-0.5">
            <ArrowRight className="w-2.5 h-2.5 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground/70 italic">{event.suggestion}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
