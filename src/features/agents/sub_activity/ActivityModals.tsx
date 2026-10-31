import { useState, useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import type { PersonaEvent, PersonaReport } from '@/lib/types/types';
import type { PersonaMemory } from '@/lib/types/types';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';
import type { AttentionLedgerEntry } from '@/lib/bindings/AttentionLedgerEntry';
import type { ManualReviewStatus } from '@/lib/bindings/ManualReviewStatus';
import { resolveReviewRow } from '@/lib/decisions/rowWrites';
import { deleteReport } from '@/api/overview/reports';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { ExecutionDetailModal } from '@/features/shared/components/modals/ExecutionDetailModal';
import { EventDetailModal } from '@/features/overview/sub_events/EventDetailModal';
import MemoryDetailModal from '@/features/overview/sub_memories/components/MemoryDetailModal';
import { ReportDetailModal } from '@/features/overview/sub_reports/components/ReportDetailModal';
import type { ActivityItem } from './activityTypes';
import { toastCatch } from '@/lib/silentCatch';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import Button from '@/features/shared/components/buttons/Button';

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
  const [selectedMessage, setSelectedMessage] = useState<PersonaReport | null>(null);
  const [selectedAttention, setSelectedAttention] = useState<AttentionLedgerEntry | null>(null);
  // Which verdict is in flight, so only the pressed control shows busy and
  // the other one is merely held (a scalar flag lit neither and dimmed both).
  const [reviewProcessing, setReviewProcessing] = useState<ManualReviewStatus | null>(null);

  const handleRowClick = useCallback((item: ActivityItem) => {
    switch (item.type) {
      case 'execution': setSelectedExecution(item.raw as PersonaExecution); break;
      case 'event': setSelectedEvent(item.raw as PersonaEvent); break;
      case 'memory': setSelectedMemory(item.raw as PersonaMemory); break;
      case 'review': setSelectedReview(item.raw as PersonaManualReview); break;
      case 'message': setSelectedMessage(item.raw as PersonaReport); break;
      case 'attention': setSelectedAttention(item.raw as AttentionLedgerEntry); break;
    }
  }, []);

  const handleReviewAction = useCallback(async (status: ManualReviewStatus, notes?: string) => {
    if (!selectedReview) return;
    setReviewProcessing(status);
    try {
      await resolveReviewRow(selectedReview, status, notes);
      setSelectedReview(null);
      onDataChanged();
    } catch (err) {
      // Was `try/finally` with no catch: a failed verdict closed the modal and
      // refreshed the activity feed exactly like a successful one, so the row
      // simply reappeared as `pending` with no explanation. The modal now stays
      // open on failure so the decision is still in the reviewer's hand.
      toastCatch('activity:resolveReview')(err);
      onDataChanged();
    } finally {
      setReviewProcessing(null);
    }
  }, [selectedReview, onDataChanged]);

  const modals = (
    <>
      {selectedExecution && (
        <ExecutionDetailModal
          execution={{ ...selectedExecution, persona_name: personaName }}
          onClose={() => setSelectedExecution(null)}
        />
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
        <ReportDetailModal
          message={selectedMessage}
          onClose={() => setSelectedMessage(null)}
          onDelete={async () => {
            // The user pressed Delete and confirmed: a failure is theirs to see.
            // It went to silentCatch, so the modal closed, the feed refreshed and
            // the "deleted" report simply came back with no word why.
            // Close only when the delete landed, like a verdict: on failure the
            // report stays in hand so the retry is one click.
            try {
              await deleteReport(selectedMessage.id);
            } catch (err) {
              toastCatch('ActivityModals:deleteReport')(err);
              return;
            }
            setSelectedMessage(null);
            onDataChanged();
          }}
        />
      )}

      {selectedAttention && (
        <DetailModal
          title={t.agents.life.activity_attention_row}
          subtitle={selectedAttention.verdict}
          onClose={() => setSelectedAttention(null)}
        >
          <div className="p-4 space-y-3">
            <div>
              <div className="typo-code text-foreground uppercase mb-1">{t.agents.activity.attention_detail_reason}</div>
              <p className="typo-body text-foreground whitespace-pre-wrap">{selectedAttention.reason}</p>
            </div>
            <div>
              <div className="typo-code text-foreground uppercase mb-1">{t.agents.activity.col_verdict}</div>
              <p className="typo-body text-foreground">{selectedAttention.verdict}</p>
            </div>
            <div>
              <div className="typo-code text-foreground uppercase mb-1">{t.agents.activity.attention_detail_started}</div>
              <p className="typo-body text-foreground"><AbsoluteTime timestamp={selectedAttention.startedAt} /></p>
            </div>
            {selectedAttention.completedAt && (
              <div>
                <div className="typo-code text-foreground uppercase mb-1">{t.agents.activity.attention_detail_completed}</div>
                <p className="typo-body text-foreground"><AbsoluteTime timestamp={selectedAttention.completedAt} /></p>
              </div>
            )}
          </div>
        </DetailModal>
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
                <div className="typo-code text-foreground uppercase mb-1">{t.agents.activity.description}</div>
                <p className="typo-body text-foreground whitespace-pre-wrap">{selectedReview.description}</p>
              </div>
            )}
            {selectedReview.context_data && (
              <div>
                <div className="typo-code text-foreground uppercase mb-1">{t.agents.activity.context}</div>
                <pre className="typo-body text-foreground bg-secondary/30 rounded-card p-2 overflow-x-auto">{selectedReview.context_data}</pre>
              </div>
            )}
            {selectedReview.status === 'pending' && (
              <div className="flex items-center gap-2 pt-2 border-t border-primary/10">
                <Button
                  variant="accent"
                  tone="success"
                  size="sm"
                  onClick={() => handleReviewAction('approved')}
                  disabled={reviewProcessing !== null}
                  loading={reviewProcessing === 'approved'}
                  loadingLabel={t.agents.activity.approve}
                  data-testid="activity-review-approve"
                >
                  {t.agents.activity.approve}
                </Button>
                <Button
                  variant="accent"
                  tone="error"
                  size="sm"
                  onClick={() => handleReviewAction('rejected')}
                  disabled={reviewProcessing !== null}
                  loading={reviewProcessing === 'rejected'}
                  loadingLabel={t.agents.activity.reject}
                  data-testid="activity-review-reject"
                >
                  {t.agents.activity.reject}
                </Button>
              </div>
            )}
            {selectedReview.reviewer_notes && (
              <div>
                <div className="typo-code text-foreground uppercase mb-1">{t.agents.activity.reviewer_notes}</div>
                <p className="typo-body text-foreground italic">{selectedReview.reviewer_notes}</p>
              </div>
            )}
          </div>
        </DetailModal>
      )}
    </>
  );

  return { handleRowClick, modals };
}
