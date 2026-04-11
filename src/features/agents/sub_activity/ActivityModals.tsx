import { useState, useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import type { PersonaEvent, PersonaMessage } from '@/lib/types/types';
import type { PersonaMemory } from '@/lib/types/types';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import { updateManualReviewStatus } from '@/api/overview/reviews';
import { deleteMessage } from '@/api/overview/messages';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { ExecutionDetail } from '@/features/agents/sub_executions/detail/ExecutionDetail';
import { EventDetailModal } from '@/features/overview/sub_events/EventDetailModal';
import MemoryDetailModal from '@/features/overview/sub_memories/components/MemoryDetailModal';
import { MessageDetailModal } from '@/features/overview/sub_messages/components/MessageDetailModal';
import type { ActivityItem } from './activityTypes';

interface ActivityModalsProps {
  personaName: string;
  personaColor: string;
  onDataChanged: () => void;
}

export function useActivityModals({ personaName, personaColor, onDataChanged }: ActivityModalsProps) {
  const { t, tx } = useTranslation();
  const [selectedExecution, setSelectedExecution] = useState<PersonaExecution | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<PersonaEvent | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<PersonaMemory | null>(null);
  const [selectedReview, setSelectedReview] = useState<PersonaManualReview | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<PersonaMessage | null>(null);
  const [reviewProcessing, setReviewProcessing] = useState(false);

  const handleRowClick = useCallback((item: ActivityItem) => {
    switch (item.type) {
      case 'execution': setSelectedExecution(item.raw as PersonaExecution); break;
      case 'event': setSelectedEvent(item.raw as PersonaEvent); break;
      case 'memory': setSelectedMemory(item.raw as PersonaMemory); break;
      case 'review': setSelectedReview(item.raw as PersonaManualReview); break;
      case 'message': setSelectedMessage(item.raw as PersonaMessage); break;
    }
  }, []);

  const handleReviewAction = useCallback(async (status: ManualReviewStatus, notes?: string) => {
    if (!selectedReview) return;
    setReviewProcessing(true);
    try {
      await updateManualReviewStatus(selectedReview.id, status, notes);
      setSelectedReview(null);
      onDataChanged();
    } finally {
      setReviewProcessing(false);
    }
  }, [selectedReview, onDataChanged]);

  const modals = (
    <>
      {selectedExecution && (
        <DetailModal
          title={tx(t.agents.activity.modal_execution_title, { name: personaName })}
          subtitle={tx(t.agents.activity.modal_execution_subtitle, { id: selectedExecution.id })}
          onClose={() => setSelectedExecution(null)}
        >
          <ExecutionDetail execution={selectedExecution} />
        </DetailModal>
      )}

      {selectedEvent && (
        <EventDetailModal event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}

      {selectedMemory && (
        <MemoryDetailModal
          memory={selectedMemory}
          personaName={personaName}
          personaColor={personaColor}
          onClose={() => setSelectedMemory(null)}
          onDelete={() => { setSelectedMemory(null); onDataChanged(); }}
        />
      )}

      {selectedMessage && (
        <MessageDetailModal
          message={selectedMessage}
          onClose={() => setSelectedMessage(null)}
          onDelete={async () => {
            await deleteMessage(selectedMessage.id).catch(() => {});
            setSelectedMessage(null);
            onDataChanged();
          }}
        />
      )}

      {selectedReview && (
        <DetailModal
          title={tx(t.agents.activity.modal_review_title, { title: selectedReview.title })}
          subtitle={tx(t.agents.activity.modal_review_subtitle, { severity: selectedReview.severity, status: selectedReview.status })}
          onClose={() => setSelectedReview(null)}
        >
          <div className="p-4 space-y-3">
            {selectedReview.description && (
              <div>
                <div className="text-sm font-mono text-muted-foreground/50 uppercase mb-1">{t.agents.activity.description}</div>
                <p className="text-sm text-foreground/80 whitespace-pre-wrap">{selectedReview.description}</p>
              </div>
            )}
            {selectedReview.context_data && (
              <div>
                <div className="text-sm font-mono text-muted-foreground/50 uppercase mb-1">{t.agents.activity.context}</div>
                <pre className="text-sm text-foreground/60 bg-secondary/30 rounded-lg p-2 overflow-x-auto">{selectedReview.context_data}</pre>
              </div>
            )}
            {selectedReview.status === 'pending' && (
              <div className="flex items-center gap-2 pt-2 border-t border-primary/10">
                <button
                  onClick={() => handleReviewAction('approved')}
                  disabled={reviewProcessing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  {t.agents.activity.approve}
                </button>
                <button
                  onClick={() => handleReviewAction('rejected')}
                  disabled={reviewProcessing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                >
                  {t.agents.activity.reject}
                </button>
              </div>
            )}
            {selectedReview.reviewer_notes && (
              <div>
                <div className="text-sm font-mono text-muted-foreground/50 uppercase mb-1">{t.agents.activity.reviewer_notes}</div>
                <p className="text-sm text-foreground/70 italic">{selectedReview.reviewer_notes}</p>
              </div>
            )}
          </div>
        </DetailModal>
      )}
    </>
  );

  return { handleRowClick, modals };
}
