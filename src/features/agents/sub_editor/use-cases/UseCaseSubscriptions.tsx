import { useState } from 'react';
import { Radio, Plus, Trash2 } from 'lucide-react';
import { AccessibleToggle } from '@/features/shared/components/AccessibleToggle';
import type { UseCaseEventSubscription } from '@/features/shared/components/UseCasesList';

const EVENT_TYPES = [
  { value: 'webhook_received', label: 'Webhook Received' },
  { value: 'execution_completed', label: 'Execution Completed' },
  { value: 'execution_failed', label: 'Execution Failed' },
  { value: 'persona_action', label: 'Persona Action' },
  { value: 'file_changed', label: 'File Changed' },
  { value: 'schedule_triggered', label: 'Schedule Triggered' },
];

interface UseCaseSubscriptionsProps {
  subscriptions: UseCaseEventSubscription[];
  onChange: (subs: UseCaseEventSubscription[]) => void;
}

export function UseCaseSubscriptions({ subscriptions, onChange }: UseCaseSubscriptionsProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEventType, setNewEventType] = useState('');
  const [newSourceFilter, setNewSourceFilter] = useState('');

  const handleToggle = (index: number) => {
    onChange(subscriptions.map((s, i) => i === index ? { ...s, enabled: !s.enabled } : s));
  };

  const handleDelete = (index: number) => {
    onChange(subscriptions.filter((_, i) => i !== index));
  };

  const handleAdd = () => {
    if (!newEventType) return;
    onChange([
      ...subscriptions,
      {
        event_type: newEventType,
        source_filter: newSourceFilter.trim() || undefined,
        enabled: true,
      },
    ]);
    setNewEventType('');
    setNewSourceFilter('');
    setShowAddForm(false);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h5 className="flex items-center gap-2 text-sm font-semibold text-foreground/90">
          <Radio className="w-3.5 h-3.5" />
          Event Subscriptions
        </h5>
        <span className="text-sm text-muted-foreground/70">
          {subscriptions.filter((s) => s.enabled).length} active
        </span>
      </div>

      <div className="space-y-1.5">
        {subscriptions.map((sub, i) => (
          <div
            key={`${sub.event_type}_${i}`}
            className={`flex items-center gap-2.5 p-2 border rounded-lg transition-colors ${
              sub.enabled
                ? 'bg-secondary/30 border-primary/15'
                : 'bg-secondary/10 border-primary/10 opacity-60'
            }`}
          >
            <Radio className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-sm font-medium text-foreground/80 block truncate">
                {sub.event_type}
              </span>
              {sub.source_filter && (
                <span className="text-[11px] text-muted-foreground/70 block truncate">
                  filter: {sub.source_filter}
                </span>
              )}
            </div>
            <AccessibleToggle
              checked={sub.enabled}
              onChange={() => handleToggle(i)}
              label={`Enable ${sub.event_type}`}
              size="sm"
            />
            <button
              onClick={() => handleDelete(i)}
              className="p-1 text-muted-foreground/70 hover:text-red-400 transition-colors"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}

        {showAddForm ? (
          <div className="border border-primary/15 rounded-lg p-2.5 space-y-2 bg-secondary/30">
            <div>
              <label className="block text-[11px] font-mono text-muted-foreground/70 uppercase mb-1">
                Event Type
              </label>
              <select
                value={newEventType}
                onChange={(e) => setNewEventType(e.target.value)}
                className="w-full px-2.5 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                <option value="">Select event type...</option>
                {EVENT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-mono text-muted-foreground/70 uppercase mb-1">
                Source Filter <span className="normal-case">(optional)</span>
              </label>
              <input
                type="text"
                value={newSourceFilter}
                onChange={(e) => setNewSourceFilter(e.target.value)}
                placeholder="e.g. persona-id or glob pattern"
                className="w-full px-2.5 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleAdd}
                disabled={!newEventType}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  newEventType
                    ? 'bg-primary hover:bg-primary/90 text-foreground'
                    : 'bg-secondary/40 text-muted-foreground/70 cursor-not-allowed'
                }`}
              >
                <Plus className="w-3 h-3" /> Add
              </button>
              <button
                onClick={() => { setShowAddForm(false); setNewEventType(''); setNewSourceFilter(''); }}
                className="px-3 py-1.5 text-sm text-muted-foreground/70 hover:text-foreground/90 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-dashed border-primary/15 hover:border-primary/30 text-sm text-muted-foreground/70 hover:text-primary/80 transition-all w-full"
          >
            <Plus className="w-3.5 h-3.5" /> Add Subscription
          </button>
        )}
      </div>
    </div>
  );
}
