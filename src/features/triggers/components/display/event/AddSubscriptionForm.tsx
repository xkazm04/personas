import { Loader2 } from 'lucide-react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { COMMON_EVENT_TYPES } from './eventTypeMeta';
interface AddSubscriptionFormProps {
  personas: { id: string; name: string }[];
  newPersonaId: string;
  newEventType: string;
  newSourceFilter: string;
  saving: boolean;
  isDuplicate: boolean | '' | undefined;
  onPersonaIdChange: (value: string) => void;
  onEventTypeChange: (value: string) => void;
  onSourceFilterChange: (value: string) => void;
  onAdd: () => void;
  onCancel: () => void;
}

export function AddSubscriptionForm({
  personas,
  newPersonaId,
  newEventType,
  newSourceFilter,
  saving,
  isDuplicate,
  onPersonaIdChange,
  onEventTypeChange,
  onSourceFilterChange,
  onAdd,
  onCancel,
}: AddSubscriptionFormProps) {
  return (
    <div className="p-4 bg-secondary/40 border border-border/30 rounded-xl space-y-3">
      <div className="grid grid-cols-3 gap-3">
        {/* Persona select */}
        <div>
          <label className="block text-sm text-muted-foreground/80 mb-1">Agent</label>
          <ThemedSelect
            value={newPersonaId}
            onChange={(e) => onPersonaIdChange(e.target.value)}
            className="py-1.5"
          >
            <option value="">Select agent...</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </ThemedSelect>
        </div>

        {/* Event type */}
        <div>
          <label className="block text-sm text-muted-foreground/80 mb-1">Event Type</label>
          <input
            list="event-type-suggestions"
            value={newEventType}
            onChange={(e) => onEventTypeChange(e.target.value)}
            placeholder="e.g. file_changed"
            className="w-full px-2.5 py-1.5 text-sm bg-background/60 border border-border/40 rounded-xl text-foreground/90 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
          <datalist id="event-type-suggestions">
            {COMMON_EVENT_TYPES.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>

        {/* Source filter */}
        <div>
          <label className="block text-sm text-muted-foreground/80 mb-1">
            Source Filter <span className="text-muted-foreground/50">(optional)</span>
          </label>
          <input
            value={newSourceFilter}
            onChange={(e) => onSourceFilterChange(e.target.value)}
            placeholder="e.g. src/**"
            className="w-full px-2.5 py-1.5 text-sm bg-background/60 border border-border/40 rounded-xl text-foreground/90 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-muted-foreground/80 hover:text-foreground transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onAdd}
          disabled={!newPersonaId || !newEventType.trim() || saving || !!isDuplicate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-primary/15 text-primary border border-primary/25 hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving && <Loader2 className="w-3 h-3 animate-spin" />}
          {isDuplicate ? 'Already Subscribed' : 'Create Subscription'}
        </button>
      </div>
    </div>
  );
}
