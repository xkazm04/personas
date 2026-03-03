import { useState, useEffect } from 'react';
import { Radio, Plus, Trash2, Loader2 } from 'lucide-react';
import { listSubscriptions, createSubscription, updateSubscription, deleteSubscription } from '@/api/tauriApi';
import { AccessibleToggle } from '@/features/shared/components/AccessibleToggle';
import { SectionCard } from '@/features/shared/components/SectionCard';
import { SectionHeader } from '@/features/shared/components/SectionHeader';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import { AddSubscriptionForm } from './AddSubscriptionForm';

interface EventSubscriptionSettingsProps {
  personaId: string;
}

export function EventSubscriptionSettings({ personaId }: EventSubscriptionSettingsProps) {
  const [subscriptions, setSubscriptions] = useState<PersonaEventSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listSubscriptions(personaId)
      .then((subs) => { if (!cancelled) setSubscriptions(subs); })
      .catch((e) => { if (!cancelled) console.error('Failed to load subscriptions:', e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [personaId]);

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
    <SectionCard size="lg" blur>
      <SectionHeader
        className="mb-5"
        icon={<Radio className="w-3.5 h-3.5" />}
        label="Event Subscriptions"
        trailing={<span className="text-sm text-muted-foreground/80">{subscriptions.length} active</span>}
      />

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
              <SectionCard
                key={sub.id}
                size="sm"
                className={`flex items-center gap-3 transition-colors ${sub.enabled ? '' : 'bg-secondary/10 opacity-60'}`}
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
              </SectionCard>
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
    </SectionCard>
  );
}
