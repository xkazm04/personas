import { useTranslation } from '@/i18n/useTranslation';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { EventDetailContent } from './components/EventDetailContent';
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
      <EventDetailContent event={event} />
    </DetailModal>
  );
}
