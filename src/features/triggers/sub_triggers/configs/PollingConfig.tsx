import { Zap } from 'lucide-react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { TriggerFieldGroup } from './TriggerFieldGroup';
import { useTranslation } from '@/i18n/useTranslation';

export interface PollingConfigProps {
  credentialEventsList: { id: string; name: string }[];
  selectedEventId: string;
  setSelectedEventId: (v: string) => void;
  endpoint: string;
  setEndpoint: (v: string) => void;
}

export function PollingConfig({
  credentialEventsList, selectedEventId, setSelectedEventId,
  endpoint, setEndpoint,
}: PollingConfigProps) {
  const { t } = useTranslation();
  return (
    <>
      {credentialEventsList.length > 0 && (
        <TriggerFieldGroup
          label={<><Zap className="w-3.5 h-3.5 inline mr-1 text-amber-400" />{t.triggers.credential_event_label}</>}
          optional
          helpText={t.triggers.credential_event_help}
        >
          <ThemedSelect
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            className="rounded-modal"
          >
            <option value="">{t.triggers.none_use_endpoint}</option>
            {credentialEventsList.map(evt => (
              <option key={evt.id} value={evt.id}>{evt.name}</option>
            ))}
          </ThemedSelect>
        </TriggerFieldGroup>
      )}
      {!selectedEventId && (
        <TriggerFieldGroup label={t.triggers.endpoint_url}>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder={t.triggers.polling_endpoint_placeholder}
            className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-modal text-foreground placeholder-muted-foreground/30 focus-ring focus-visible:border-primary/40 transition-all"
          />
        </TriggerFieldGroup>
      )}
    </>
  );
}
