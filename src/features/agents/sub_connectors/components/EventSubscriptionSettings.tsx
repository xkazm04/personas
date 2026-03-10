import { useState, useEffect, useCallback } from 'react';
import { Radio, Plus, RotateCw } from 'lucide-react';
import { listSubscriptions, createSubscription, updateSubscription, deleteSubscription } from '@/api/tauriApi';
import { SectionCard } from '@/features/shared/components/SectionCard';
import { SectionHeader } from '@/features/shared/components/SectionHeader';
import EmptyState from '@/features/shared/components/EmptyState';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import { AddSubscriptionForm } from './AddSubscriptionForm';
import { SubscriptionRow, useConfirmDelete } from './SubscriptionForm';
import ContentLoader from '@/features/shared/components/ContentLoader';

interface EventSubscriptionSettingsProps {
  personaId: string;
}

export function EventSubscriptionSettings({ personaId }: EventSubscriptionSettingsProps) {
  const [subscriptions, setSubscriptions] = useState<PersonaEventSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadEpoch, setLoadEpoch] = useState(0);
  const [showAddForm, setShowAddForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirmingDeleteId, setConfirmingDeleteId } = useConfirmDelete();

  const activeCount = subscriptions.filter((s) => s.enabled).length;

  const retryLoad = useCallback(() => setLoadEpoch((e) => e + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    listSubscriptions(personaId)
      .then((subs) => { if (!cancelled) setSubscriptions(subs); })
      .catch((e) => {
        if (!cancelled) {
          setLoadError(`Failed to load subscriptions: ${e instanceof Error ? e.message : 'unknown error'}`);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [personaId, loadEpoch]);

  const handleToggle = async (sub: PersonaEventSubscription) => {
    try {
      setError(null);
      const updated = await updateSubscription(sub.id, { enabled: !sub.enabled, event_type: sub.event_type, source_filter: sub.source_filter });
      setSubscriptions((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (e) { setError('Failed to toggle subscription'); console.error('Failed to toggle subscription:', e); }
  };

  const handleDelete = async (id: string) => {
    try {
      setError(null);
      const deleted = await deleteSubscription(id);
      if (!deleted) { setError('Delete failed. Subscription may still exist.'); return; }
      setSubscriptions((prev) => prev.filter((s) => s.id !== id));
    } catch (e) { setError('Failed to delete subscription'); console.error('Failed to delete subscription:', e); }
  };

  const handleAdd = async (eventType: string, sourceFilter: string) => {
    try {
      const created = await createSubscription({ persona_id: personaId, event_type: eventType, source_filter: sourceFilter || null, enabled: true, use_case_id: null });
      setSubscriptions((prev) => [...prev, created]);
      setShowAddForm(false);
    } catch (e) { console.error('Failed to create subscription:', e); }
  };

  return (
    <SectionCard size="lg" blur>
      <SectionHeader className="mb-6" icon={<Radio className="w-3.5 h-3.5" />} label="Event Subscriptions"
        trailing={<span className="text-sm text-muted-foreground/80">{activeCount} active</span>} />
      <div className="space-y-3">
        {error && <div className="px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/10 text-sm text-red-400/80">{error}</div>}
        {loadError && (
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-red-500/20 bg-red-500/5">
            <p className="flex-1 text-sm text-red-400/80">{loadError}</p>
            <button onClick={retryLoad} className="flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-lg border border-red-500/20 text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0">
              <RotateCw className="w-3 h-3" /> Retry
            </button>
          </div>
        )}
        {loading ? (
          <ContentLoader variant="panel" hint="subscriptions" />
        ) : (
          <>
            {subscriptions.length === 0 && !showAddForm && (
              <EmptyState variant="subscriptions-empty" className="py-4" />
            )}
            {subscriptions.map((sub) => (
              <SubscriptionRow key={sub.id} sub={sub} confirmingDeleteId={confirmingDeleteId}
                onToggle={handleToggle} onDelete={handleDelete} onConfirmDelete={setConfirmingDeleteId} />
            ))}
            {showAddForm ? (
              <AddSubscriptionForm onAdd={handleAdd} onCancel={() => setShowAddForm(false)} />
            ) : (
              <button onClick={() => setShowAddForm(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-primary/15 hover:border-primary/40 text-sm text-muted-foreground/80 hover:text-primary/80 transition-all w-full focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none focus-visible:rounded-xl">
                <Plus className="w-4 h-4" /> Add Subscription
              </button>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}
