import { useState, useEffect, useCallback } from 'react';
import { Plus, Radio, Loader2 } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import * as eventsApi from '@/api/overview/events';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import { AddSubscriptionForm } from './AddSubscriptionForm';
import { SubscriptionRow } from './SubscriptionRow';

export function EventSubscriptionsPanel() {
  const personas = usePersonaStore((s) => s.personas);

  const [subscriptions, setSubscriptions] = useState<PersonaEventSubscription[]>([]);
  const [loading, setLoading] = useState(true);

  // Add-form state
  const [adding, setAdding] = useState(false);
  const [newPersonaId, setNewPersonaId] = useState('');
  const [newEventType, setNewEventType] = useState('');
  const [newSourceFilter, setNewSourceFilter] = useState('');
  const [saving, setSaving] = useState(false);

  // Track toggling / deleting per-row
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const fetchAll = useCallback(async () => {
    try {
      const subs = await eventsApi.listAllSubscriptions();
      setSubscriptions(subs);
    } catch (err) {
      console.error('Failed to fetch subscriptions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (personas.length > 0) {
      fetchAll();
    } else {
      setSubscriptions([]);
      setLoading(false);
    }
  }, [personas, fetchAll]);

  const personaName = (id: string) =>
    personas.find((p) => p.id === id)?.name ?? 'Unknown';

  const handleToggle = async (sub: PersonaEventSubscription) => {
    setBusyIds((s) => new Set(s).add(sub.id));
    try {
      const updated = await eventsApi.updateSubscription(sub.id, {
        event_type: null,
        source_filter: null,
        enabled: !sub.enabled,
      });
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s)),
      );
    } catch (err) {
      console.error('Toggle failed:', err);
    } finally {
      setBusyIds((s) => {
        const next = new Set(s);
        next.delete(sub.id);
        return next;
      });
    }
  };

  const handleDelete = async (id: string) => {
    setBusyIds((s) => new Set(s).add(id));
    try {
      await eventsApi.deleteSubscription(id);
      setSubscriptions((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setBusyIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };

  const isDuplicate = newPersonaId && newEventType.trim() && subscriptions.some(
    (s) =>
      s.persona_id === newPersonaId &&
      s.event_type === newEventType.trim() &&
      (s.source_filter ?? '') === (newSourceFilter.trim() || ''),
  );

  const handleAdd = async () => {
    if (!newPersonaId || !newEventType.trim() || isDuplicate) return;
    setSaving(true);
    try {
      const created = await eventsApi.createSubscription({
        persona_id: newPersonaId,
        event_type: newEventType.trim(),
        source_filter: newSourceFilter.trim() || null,
        enabled: true,
        use_case_id: null,
      });
      setSubscriptions((prev) => [created, ...prev]);
      setAdding(false);
      setNewPersonaId('');
      setNewEventType('');
      setNewSourceFilter('');
    } catch (err) {
      console.error('Create failed:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/60" />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-4">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
              Event Subscriptions
            </h3>
            <button
              onClick={() => setAdding(!adding)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>

          {/* Add form */}
          {adding && (
            <AddSubscriptionForm
              personas={personas}
              newPersonaId={newPersonaId}
              newEventType={newEventType}
              newSourceFilter={newSourceFilter}
              saving={saving}
              isDuplicate={isDuplicate}
              onPersonaIdChange={setNewPersonaId}
              onEventTypeChange={setNewEventType}
              onSourceFilterChange={setNewSourceFilter}
              onAdd={handleAdd}
              onCancel={() => setAdding(false)}
            />
          )}

          {/* Subscriptions table */}
          {subscriptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Radio className="w-8 h-8 text-muted-foreground/50 mb-3" />
              <p className="text-sm text-muted-foreground/70">No event subscriptions yet</p>
              <p className="text-sm text-muted-foreground/50 mt-1">
                Subscribe agents to event types so they activate automatically
              </p>
            </div>
          ) : (
            <div className="border border-border/30 rounded-xl overflow-hidden">
              {/* Column headers */}
              <div className="grid grid-cols-[1fr_1fr_1fr_80px_40px] gap-3 px-4 py-2.5 bg-secondary/30 border-b border-border/20 text-sm font-mono text-muted-foreground/70 uppercase tracking-wider">
                <span>Agent</span>
                <span>Event Type</span>
                <span>Source Filter</span>
                <span className="text-center">Status</span>
                <span />
              </div>

              {/* Rows */}
              {subscriptions.map((sub) => (
                <SubscriptionRow
                  key={sub.id}
                  sub={sub}
                  personaName={personaName(sub.persona_id)}
                  busy={busyIds.has(sub.id)}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
