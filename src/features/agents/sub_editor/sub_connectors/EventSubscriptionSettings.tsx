import { useState, useEffect, useCallback } from 'react';
import { Radio, Plus, Trash2, Loader2 } from 'lucide-react';
import { listSubscriptions, createSubscription, updateSubscription, deleteSubscription } from '@/api/tauriApi';
import { AccessibleToggle } from '@/features/shared/components/AccessibleToggle';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import { AddSubscriptionForm } from './AddSubscriptionForm';

interface EventSubscriptionSettingsProps {
  personaId: string;
}

export function EventSubscriptionSettings({ personaId }: EventSubscriptionSettingsProps) {
  const [subscriptions, setSubscriptions] = useState<PersonaEventSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

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

  const handleAdd = async (eventType: string, sourceFilter: string) => {
    try {
      const created = await createSubscription({
        persona_id: personaId,
        event_type: eventType,
        source_filter: sourceFilter || null,
        enabled: true,
        use_case_id: null,
      });
      setSubscriptions((prev) => [...prev, created]);
      setShowAddForm(false);
    } catch (e) {
      console.error('Failed to create subscription:', e);
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
              <AddSubscriptionForm
                onAdd={handleAdd}
                onCancel={() => setShowAddForm(false)}
              />
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
