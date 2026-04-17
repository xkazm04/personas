import { MessageSquare, AlertTriangle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DesignConversation } from '@/lib/types/designTypes';
import type { DesignDriftEvent } from '@/lib/design/designDrift';
import { ConversationCard, DriftNotificationCard } from './ConversationMessageList';

interface DesignConversationHistoryProps {
  conversations: DesignConversation[];
  activeConversationId: string | null;
  onResumeConversation: (conversation: DesignConversation) => void;
  onDeleteConversation: (id: string) => void;
  driftEvents?: DesignDriftEvent[];
  onDismissDrift?: (id: string) => void;
}

export function DesignConversationHistory({
  conversations, activeConversationId,
  onResumeConversation, onDeleteConversation,
  driftEvents, onDismissDrift,
}: DesignConversationHistoryProps) {
  const { t } = useTranslation();
  const visibleDrift = driftEvents?.filter((e) => !e.dismissed) ?? [];
  const hasContent = conversations.length > 0 || visibleDrift.length > 0;

  if (!hasContent) return null;

  return (
    <div className="space-y-2.5" data-testid="design-conversation-history">
      {visibleDrift.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-1">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400/70" />
            <span className="typo-body font-medium text-amber-400/80 uppercase tracking-wide">{t.agents.design.design_drift}</span>
            <span className="typo-body text-foreground">({visibleDrift.length})</span>
          </div>
          {visibleDrift.map((event) => (
              <DriftNotificationCard key={event.id} event={event} onDismiss={() => onDismissDrift?.(event.id)} />
            ))}
        </div>
      )}

      {conversations.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 px-1">
            <MessageSquare className="w-3.5 h-3.5 text-foreground" />
            <span className="typo-body font-medium text-foreground uppercase tracking-wide">{t.agents.design.design_sessions}</span>
            <span className="typo-body text-foreground">({conversations.length})</span>
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
      )}
    </div>
  );
}
