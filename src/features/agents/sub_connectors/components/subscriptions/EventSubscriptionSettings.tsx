import { useState, useEffect, useCallback } from 'react';
import { Radio, Plus, RotateCw } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { createSubscription, deleteSubscription, listSubscriptions, updateSubscription } from "@/api/overview/events";

import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { SectionHeader } from '@/features/shared/components/layout/SectionHeader';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import { AddSubscriptionForm } from './AddSubscriptionForm';
import { SubscriptionRow, useConfirmDelete } from './SubscriptionForm';
import ContentLoader from '@/features/shared/components/progress/ContentLoader';
import { createLogger } from "@/lib/log";

const logger = createLogger("event-subscription-settings");

interface EventSubscriptionSettingsProps {
  personaId: string;
}

export function EventSubscriptionSettings({ personaId }: EventSubscriptionSettingsProps) {
  const { t, tx } = useTranslation();
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
    } catch (e) { setError('Failed to toggle subscription'); logger.error('Failed to toggle subscription', { error: e }); }
  };

  const handleDelete = async (id: string) => {
    try {
      setError(null);
      const deleted = await deleteSubscription(id);
      if (!deleted) { setError('Delete failed. Subscription may still exist.'); return; }
      setSubscriptions((prev) => prev.filter((s) => s.id !== id));
    } catch (e) { setError('Failed to delete subscription'); logger.error('Failed to delete subscription', { error: e }); }
  };

  const handleAdd = async (eventType: string, sourceFilter: string) => {
    try {
      const created = await createSubscription({ persona_id: personaId, event_type: eventType, source_filter: sourceFilter || null, enabled: true, use_case_id: null });
      setSubscriptions((prev) => [...prev, created]);
      setShowAddForm(false);
    } catch (e) { logger.error('Failed to create subscription', { error: e }); }
  };

  return (
    <SectionCard size="lg" blur>
      <SectionHeader className="mb-6" icon={<Radio className="w-3.5 h-3.5" />} label={t.agents.connectors.sub_title}
        trailing={<span className="typo-body text-foreground">{tx(t.agents.connectors.sub_active, { count: activeCount })}</span>} />
      <div className="space-y-3">
        {error && <div role="alert" className="px-3 py-2 rounded-modal border border-red-500/20 bg-red-500/10 typo-body text-red-400/80">{error}</div>}
        {loadError && (
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-modal border border-red-500/20 bg-red-500/5">
            <p className="flex-1 typo-body text-red-400/80">{loadError}</p>
            <button onClick={retryLoad} className="flex items-center gap-1.5 px-2.5 py-1 typo-body rounded-card border border-red-500/20 text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-colors flex-shrink-0">
              <RotateCw className="w-3 h-3" /> {t.common.retry}
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
                className="flex items-center gap-2 px-3 py-2 rounded-modal border border-dashed border-primary/20 hover:border-primary/40 typo-body text-foreground hover:text-primary/80 transition-all w-full focus-ring">
                <Plus className="w-4 h-4" /> {t.agents.connectors.sub_add}
              </button>
            )}
          </>
        )}
      </div>
    </SectionCard>
  );
}
