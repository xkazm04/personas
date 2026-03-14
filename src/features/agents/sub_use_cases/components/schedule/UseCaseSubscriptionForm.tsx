import { useState } from 'react';
import { Plus } from 'lucide-react';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { UseCaseEventSubscription } from '@/features/shared/components/use-cases/UseCasesList';

const EVENT_TYPES = [
  { value: 'webhook_received', label: 'Webhook Received' },
  { value: 'execution_completed', label: 'Execution Completed' },
  { value: 'execution_failed', label: 'Execution Failed' },
  { value: 'persona_action', label: 'Persona Action' },
  { value: 'file_changed', label: 'File Changed' },
  { value: 'schedule_triggered', label: 'Schedule Triggered' },
];

interface UseCaseSubscriptionFormProps {
  onAdd: (sub: UseCaseEventSubscription) => void;
  onCancel: () => void;
}

export function UseCaseSubscriptionForm({ onAdd, onCancel }: UseCaseSubscriptionFormProps) {
  const [newEventType, setNewEventType] = useState('');
  const [newSourceFilter, setNewSourceFilter] = useState('');

  const handleAdd = () => {
    if (!newEventType) return;
    onAdd({
      event_type: newEventType,
      source_filter: newSourceFilter.trim() || undefined,
      enabled: true,
    });
    setNewEventType('');
    setNewSourceFilter('');
  };

  return (
    <div className="border border-primary/20 rounded-lg p-2.5 space-y-2 bg-secondary/30">
      <div>
        <label className="block text-sm font-mono text-muted-foreground/70 uppercase mb-1">
          Event Type
        </label>
        <ThemedSelect
          value={newEventType}
          onChange={(e) => setNewEventType(e.target.value)}
          className="py-1.5"
        >
          <option value="">Select event type...</option>
          {EVENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </ThemedSelect>
      </div>
      <div>
        <label className="block text-sm font-mono text-muted-foreground/70 uppercase mb-1">
          Source Filter <span className="normal-case">(optional)</span>
        </label>
        <input
          type="text"
          value={newSourceFilter}
          onChange={(e) => setNewSourceFilter(e.target.value)}
          placeholder="e.g. persona-id or glob pattern"
          className="w-full px-2.5 py-1.5 bg-background/50 border border-primary/20 rounded-xl text-sm text-foreground placeholder:text-muted-foreground/60 focus-ring"
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleAdd}
          disabled={!newEventType}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${
            newEventType
              ? 'bg-primary hover:bg-primary/90 text-foreground'
              : 'bg-secondary/40 text-muted-foreground/70 cursor-not-allowed'
          }`}
        >
          <Plus className="w-3 h-3" /> Add
        </button>
        <button
          onClick={() => { onCancel(); setNewEventType(''); setNewSourceFilter(''); }}
          className="px-3 py-1.5 text-sm text-muted-foreground/70 hover:text-foreground/90 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
