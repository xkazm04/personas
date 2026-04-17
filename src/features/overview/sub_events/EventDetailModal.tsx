import { UuidLabel } from '@/features/shared/components/display/UuidLabel';
import { useTranslation } from '@/i18n/useTranslation';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { HighlightedJson } from './HighlightedJson';
import type { PersonaEvent } from '@/lib/types/types';

interface EventDetailModalProps {
  event: PersonaEvent;
  onClose: () => void;
}

export function EventDetailModal({ event, onClose }: EventDetailModalProps) {
  const { t } = useTranslation();
  return (
    <DetailModal
        title={`${t.overview.events.event_detail_title} ${event.event_type}`}
        subtitle={`${t.overview.events.event_detail_status} ${event.status}`}
        onClose={onClose}
      >
        <div className="space-y-4">
          {/* IDs & metadata */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="typo-body text-foreground font-medium block mb-0.5">{t.overview.events.event_id}</span>
              <span className="typo-body"><UuidLabel value={event.id} /></span>
            </div>
            <div>
              <span className="typo-body text-foreground font-medium block mb-0.5">{t.overview.events.project}</span>
              <span className="typo-body"><UuidLabel value={event.project_id} /></span>
            </div>
            {event.source_id && (
              <div>
                <span className="typo-body text-foreground font-medium block mb-0.5">{t.overview.events.source}</span>
                <span className="typo-body">
                  <UuidLabel value={event.source_id} label={event.source_type || undefined} />
                </span>
              </div>
            )}
            {event.processed_at && (
              <div className="rounded-modal border border-primary/10 bg-background/30 px-2.5 py-2">
                <span className="typo-code font-mono text-foreground font-medium">{t.overview.events.processed}</span>
                <span className="ml-2 typo-body text-foreground">
                  {new Date(event.processed_at).toLocaleString()}
                </span>
              </div>
            )}
          </div>

          {/* Payload */}
          {event.payload && (
            <div>
              <span className="typo-body text-foreground font-medium block mb-1">{t.overview.events.event_data}</span>
              <div className="rounded-modal border border-primary/10 bg-secondary/20 p-3 overflow-hidden">
                <HighlightedJson raw={event.payload} />
              </div>
            </div>
          )}

          {/* Error */}
          {event.error_message && (
            <div>
              <span className="typo-body text-red-400 block mb-1">{t.overview.events.error}</span>
              <pre className="bg-red-500/5 p-2 rounded-card text-red-400 typo-body whitespace-pre-wrap">
                {event.error_message}
              </pre>
            </div>
          )}
        </div>
      </DetailModal>
  );
}
