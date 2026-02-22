import { useState, useEffect, useCallback } from 'react';
import { Radio, Plus, Trash2, Loader2 } from 'lucide-react';
import { listSubscriptions, createSubscription, updateSubscription, deleteSubscription } from '@/api/tauriApi';
import { AccessibleToggle } from '@/features/shared/components/AccessibleToggle';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';

interface EventSubscriptionSettingsProps {
  personaId: string;
}

const EVENT_TYPES = [
  { value: 'webhook_received', label: 'Webhook Received' },
  { value: 'execution_completed', label: 'Execution Completed' },
  { value: 'execution_failed', label: 'Execution Failed' },
  { value: 'persona_action', label: 'Persona Action' },
  { value: 'file_changed', label: 'File Changed' },
  { value: 'schedule_triggered', label: 'Schedule Triggered' },
];

export function EventSubscriptionSettings({ personaId }: EventSubscriptionSettingsProps) {
  const [subscriptions, setSubscriptions] = useState<PersonaEventSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEventType, setNewEventType] = useState('');
  const [newSourceFilter, setNewSourceFilter] = useState('');
  const [saving, setSaving] = useState(false);

  const loadSubscriptions = useCallback(async () => {
    try {
      const subs = await listSubscriptions(personaId);
      setSubscriptions(subs);
    } catch (e) {
      console.error('Failed to load subscriptions:', e);
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    setLoading(true);
    loadSubscriptions();
  }, [loadSubscriptions]);

  const handleToggle = async (sub: PersonaEventSubscription) => {
    try {
      const updated = await updateSubscription(sub.id, { enabled: !sub.enabled, event_type: null, source_filter: null });
      setSubscriptions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (e) {
      console.error('Failed to toggle subscription:', e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteSubscription(id);
      setSubscriptions((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      console.error('Failed to delete subscription:', e);
    }
  };

  const handleAdd = async () => {
    if (!newEventType) return;
    setSaving(true);
    try {
      const created = await createSubscription({
        persona_id: personaId,
        event_type: newEventType,
        source_filter: newSourceFilter.trim() || null,
        enabled: true,
      });
      setSubscriptions((prev) => [...prev, created]);
      setNewEventType('');
      setNewSourceFilter('');
      setShowAddForm(false);
    } catch (e) {
      console.error('Failed to create subscription:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider flex items-center gap-2">
          <Radio className="w-4 h-4" />
          Event Subscriptions
        </h3>
        <span className="text-sm text-muted-foreground/80">{subscriptions.length} active</span>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-4 text-muted-foreground/80">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : (
          <>
            {subscriptions.length === 0 && !showAddForm && (
              <p className="text-sm text-muted-foreground/80 py-2">
                No event subscriptions. Add one to trigger this persona on events.
              </p>
            )}

            {subscriptions.map((sub) => (
              <div
                key={sub.id}
                className={`flex items-center gap-3 p-2.5 border rounded-xl transition-colors ${
                  sub.enabled
                    ? 'bg-secondary/30 border-primary/15'
                    : 'bg-secondary/10 border-primary/15 opacity-60'
                }`}
              >
                <Radio className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground/80 block truncate">
                    {sub.event_type}
                  </span>
                  {sub.source_filter && (
                    <span className="text-sm text-muted-foreground/80 block truncate">
                      filter: {sub.source_filter}
                    </span>
                  )}
                </div>
                <AccessibleToggle
                  checked={sub.enabled}
                  onChange={() => handleToggle(sub)}
                  label={`Enable ${sub.event_type} subscription`}
                  size="sm"
                />
                <button
                  onClick={() => handleDelete(sub.id)}
                  className="p-1 text-muted-foreground/80 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}

            {showAddForm ? (
              <div className="border border-primary/15 rounded-xl p-2.5 space-y-2 bg-secondary/30">
                <div>
                  <label className="block text-sm font-mono text-muted-foreground/80 uppercase mb-1">
                    Event Type
                  </label>
                  <select
                    value={newEventType}
                    onChange={(e) => setNewEventType(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                  >
                    <option value="">Select event type...</option>
                    {EVENT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-mono text-muted-foreground/80 uppercase mb-1">
                    Source Filter <span className="normal-case">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={newSourceFilter}
                    onChange={(e) => setNewSourceFilter(e.target.value)}
                    placeholder="e.g. persona-id or glob pattern"
                    className="w-full px-2.5 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder:text-muted-foreground/80 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={handleAdd}
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
                    onClick={() => { setShowAddForm(false); setNewEventType(''); setNewSourceFilter(''); }}
                    className="px-3 py-1.5 text-sm text-muted-foreground/80 hover:text-foreground/95 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddForm(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-primary/15 hover:border-primary/40 text-sm text-muted-foreground/80 hover:text-primary/80 transition-all w-full"
              >
                <Plus className="w-4 h-4" />
                Add Subscription
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
