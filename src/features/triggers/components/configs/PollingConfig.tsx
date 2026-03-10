import { Zap } from 'lucide-react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';

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
  return (
    <>
      {credentialEventsList.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-foreground/80 mb-1.5">
            <Zap className="w-3.5 h-3.5 inline mr-1 text-amber-400" />
            Credential Event (optional)
          </label>
          <ThemedSelect
            value={selectedEventId}
            onChange={(e) => setSelectedEventId(e.target.value)}
            className="rounded-xl"
          >
            <option value="">None - use endpoint URL instead</option>
            {credentialEventsList.map(evt => (
              <option key={evt.id} value={evt.id}>{evt.name}</option>
            ))}
          </ThemedSelect>
          <p className="text-sm text-muted-foreground/80 mt-1">Link to a credential event instead of a custom endpoint</p>
        </div>
      )}
      {!selectedEventId && (
        <div>
          <label className="block text-sm font-medium text-foreground/80 mb-1.5">
            Endpoint URL
          </label>
          <input
            type="text"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="https://api.example.com/poll"
            className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
          />
        </div>
      )}
    </>
  );
}
