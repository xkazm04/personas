import { useState, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Radio, Plus, Trash2, Loader2 } from 'lucide-react';
import { createSubscription, deleteSubscription, listSubscriptions, updateSubscription } from "@/api/overview/events";
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { SectionHeader } from '@/features/shared/components/layout/SectionHeader';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import { AddSubscriptionForm } from './AddSubscriptionForm';

interface EventSubscriptionSettingsProps {
  personaId: string;
}

export function EventSubscriptionSettings({ personaId }: EventSubscriptionSettingsProps) {
  const [subscriptions, setSubscriptions] = useState<PersonaEventSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const activeCount = subscriptions.filter((s) => s.enabled).length;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listSubscriptions(personaId)
      .then((subs) => { if (!cancelled) setSubscriptions(subs); })
      .catch((e) => { if (!cancelled) console.error('Failed to load subscriptions:', e); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [personaId]);

  useEffect(() => {
    if (!confirmingDeleteId) return;

    const timer = setTimeout(() => setConfirmingDeleteId(null), 2000);
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(`[data-sub-delete="${confirmingDeleteId}"]`)) {
        setConfirmingDeleteId(null);
      }
    };

    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [confirmingDeleteId]);

  const handleToggle = async (sub: PersonaEventSubscription) => {
    try {
      setError(null);
      const updated = await updateSubscription(sub.id, {
        enabled: !sub.enabled,
        event_type: sub.event_type,
        source_filter: sub.source_filter,
      });
      setSubscriptions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (e) {
      setError('Failed to toggle subscription');
      console.error('Failed to toggle subscription:', e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      setError(null);
      const deleted = await deleteSubscription(id);
      if (!deleted) {
        setError('Delete failed. Subscription may still exist.');
        return;
      }
      setSubscriptions((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      setError('Failed to delete subscription');
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
        className="mb-6"
        icon={<Radio className="w-3.5 h-3.5" />}
        label="Event Subscriptions"
        trailing={<span className="text-sm text-muted-foreground/80">{activeCount} active</span>}
      />

      <div className="space-y-3">
        {error && (
          <div className="px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/10 text-sm text-red-400/80">
            {error}
          </div>
        )}
        {loading ? (
          <div className="flex items-center justify-center py-4 text-muted-foreground/80">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : (
          <>
            {subscriptions.length === 0 && !showAddForm && (
              <EmptyState
                icon={Radio}
                title="No event subscriptions yet"
                subtitle="Add a subscription to trigger this persona when matching events arrive."
                iconContainerClassName="bg-cyan-500/10 border-cyan-500/20"
                iconColor="text-cyan-400/75"
                className="py-4"
              />
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
                  onClick={() => {
                    if (confirmingDeleteId === sub.id) {
                      void handleDelete(sub.id);
                      setConfirmingDeleteId(null);
                      return;
                    }
                    setConfirmingDeleteId(sub.id);
                  }}
                  data-sub-delete={sub.id}
                  className="p-1 text-muted-foreground/80 hover:text-red-400 transition-colors focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none focus-visible:rounded-xl"
                >
                  <AnimatePresence mode="wait" initial={false}>
                    {confirmingDeleteId === sub.id ? (
                      <motion.span
                        key="confirm"
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: [1, 1.04, 1] }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 0.2 }}
                        className="text-sm font-semibold text-red-400"
                      >
                        Confirm?
                      </motion.span>
                    ) : (
                      <motion.span
                        key="trash"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </motion.span>
                    )}
                  </AnimatePresence>
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
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-primary/20 hover:border-primary/40 text-sm text-muted-foreground/80 hover:text-primary/80 transition-all w-full focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none focus-visible:rounded-xl"
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
