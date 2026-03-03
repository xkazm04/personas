import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { FieldHint } from '@/features/shared/components/FieldHint';
import { ThemedSelect } from '@/features/shared/components/ThemedSelect';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

const EVENT_TYPES = [
  { value: 'webhook_received', label: 'Webhook Received' },
  { value: 'execution_completed', label: 'Execution Completed' },
  { value: 'execution_failed', label: 'Execution Failed' },
  { value: 'persona_action', label: 'Persona Action' },
  { value: 'file_changed', label: 'File Changed' },
  { value: 'schedule_triggered', label: 'Schedule Triggered' },
];

interface AddSubscriptionFormProps {
  onAdd: (eventType: string, sourceFilter: string) => Promise<void>;
  onCancel: () => void;
}

export function AddSubscriptionForm({ onAdd, onCancel }: AddSubscriptionFormProps) {
  const [newEventType, setNewEventType] = useState('');
  const [newSourceFilter, setNewSourceFilter] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!newEventType) return;
    setSaving(true);
    try {
      await onAdd(newEventType, newSourceFilter.trim());
      setNewEventType('');
      setNewSourceFilter('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-primary/15 rounded-xl p-2.5 space-y-2 bg-secondary/30">
      <div>
        <label className="block text-sm font-mono text-muted-foreground/80 uppercase mb-1">
          Event Type
          <FieldHint
            text="The type of system event that will trigger this persona to run."
            example="execution_completed"
          />
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
        <label className="block text-sm font-mono text-muted-foreground/80 uppercase mb-1">
          Source Filter <span className="normal-case">(optional)</span>
          <FieldHint
            text="Only trigger when the event source matches this filter. Supports exact persona IDs or glob patterns with * wildcards."
            example="persona-abc* or team-*"
          />
        </label>
        <input
          type="text"
          value={newSourceFilter}
          onChange={(e) => setNewSourceFilter(e.target.value)}
          placeholder="e.g. persona-id or glob pattern"
          className={INPUT_FIELD}
        />
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => void handleAdd()}
          disabled={!newEventType || saving}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
            newEventType && !saving
              ? 'bg-primary hover:bg-primary/90 text-foreground'
              : 'bg-secondary/40 text-muted-foreground/80 cursor-not-allowed'
          }`}
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
          Add
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-sm text-muted-foreground/80 hover:text-foreground/95 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
