import { AnimatePresence } from 'framer-motion';
import { PhaseIndicator } from '../PhaseIndicator';
import { DesignConversationHistory } from './DesignConversationHistory';
import type { DesignPhase, DesignConversation } from '@/lib/types/designTypes';
import type { DesignDriftEvent } from '@/lib/design/designDrift';
import { renderPhaseContent, type PhaseRenderProps } from './PhaseContentRenderers';

export interface DesignTabPhaseContentProps extends PhaseRenderProps {
  phase: DesignPhase;
  conversations: DesignConversation[];
  activeConversationId: string | null;
  onResumeConversation: (conversation: DesignConversation) => void;
  onDeleteConversation: (id: string) => void;
  driftEvents?: DesignDriftEvent[];
  onDismissDrift?: (id: string) => void;
}

export function DesignTabPhaseContent(props: DesignTabPhaseContentProps) {
  const {
    phase, conversations, activeConversationId,
    onResumeConversation, onDeleteConversation, driftEvents, onDismissDrift,
    ...phaseProps
  } = props;

  return (
    <div className="space-y-4" aria-live="polite" aria-atomic="true">
      <PhaseIndicator phase={phase} />

      {phase === 'idle' && (conversations.length > 0 || (driftEvents && driftEvents.some(e => !e.dismissed))) && (
        <DesignConversationHistory
          conversations={conversations}
          activeConversationId={activeConversationId}
          onResumeConversation={onResumeConversation}
          onDeleteConversation={onDeleteConversation}
          driftEvents={driftEvents}
          onDismissDrift={onDismissDrift}
        />
      )}

      <AnimatePresence mode="wait">
        {renderPhaseContent({ phase, ...phaseProps })}
      </AnimatePresence>
    </div>
  );
}
