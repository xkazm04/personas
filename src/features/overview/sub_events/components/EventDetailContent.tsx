import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { UuidLabel } from '@/features/shared/components/display/UuidLabel';
import type { PersonaEvent } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';
import { HighlightedJson } from '../HighlightedJson';

// -- Event Detail Content ---------------------------------------------
//
// Single source for the body of an event detail view. Rendered inside a
// `DetailModal` both by the Events tab (`EventLogList`) and by the activity
// feed (`EventDetailModal`). The payload colorizer + its copy affordance live
// in the shared `HighlightedJson`, so this component holds no copy state.

interface EventDetailContentProps {
  event: PersonaEvent;
}

export function EventDetailContent({ event }: EventDetailContentProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="grid grid-cols-2 gap-3 flex-shrink-0">
        <div>
          <span className="typo-body text-foreground font-medium block mb-0.5">{t.overview.event_log_item.event_id}</span>
          <span className="typo-body"><UuidLabel value={event.id} /></span>
        </div>
        <div>
          <span className="typo-body text-foreground font-medium block mb-0.5">{t.overview.event_log_item.project}</span>
          <span className="typo-body"><UuidLabel value={event.project_id} /></span>
        </div>
        {event.source_id && (
          <div>
            <span className="typo-body text-foreground font-medium block mb-0.5">{t.overview.event_log_item.source}</span>
            <span className="typo-body">
              <UuidLabel value={event.source_id} label={event.source_type || undefined} />
            </span>
          </div>
        )}
        {event.processed_at && (
          <div className="rounded-modal border border-primary/10 bg-background/30 px-2.5 py-2">
            <span className="typo-code font-mono text-foreground font-medium">{t.overview.event_log_item.processed}</span>
            <span className="ml-2 typo-body text-foreground">
              <AbsoluteTime timestamp={event.processed_at} />
            </span>
          </div>
        )}
      </div>

      {event.payload && (
        <div className="flex-1 min-h-0 flex flex-col">
          <span className="typo-body text-foreground font-medium mb-1 flex-shrink-0">{t.overview.event_log_item.event_data}</span>
          <div className="flex-1 min-h-0 flex flex-col rounded-modal border border-primary/10 bg-secondary/20 p-3">
            <HighlightedJson raw={event.payload} />
          </div>
        </div>
      )}

      {event.error_message && (
        <div>
          <span className="typo-body text-red-400 block mb-1">{t.overview.event_log_item.error}</span>
          <pre className="bg-red-500/5 p-2 rounded-card text-red-400 typo-body whitespace-pre-wrap">
            {event.error_message}
          </pre>
        </div>
      )}
    </div>
  );
}
