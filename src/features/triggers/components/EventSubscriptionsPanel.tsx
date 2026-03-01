import { useState, useEffect, useCallback } from 'react';
import {
  Plus, Trash2, Radio, Loader2,
  CheckCircle2, XCircle, AlertTriangle, Webhook,
  FileEdit, Rocket, Clock, Link, Zap,
} from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import * as eventsApi from '@/api/events';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';

const COMMON_EVENT_TYPES = [
  'file_changed',
  'build_complete',
  'deploy',
  'test_passed',
  'test_failed',
  'error',
  'alert',
  'schedule_fired',
  'webhook_received',
  'chain_completed',
];

// ── Event type color/icon metadata ───────────────────────────────────
interface EventTypeMeta {
  Icon: typeof CheckCircle2;
  /** Tailwind text color class */
  text: string;
  /** Tailwind bg tint class */
  bg: string;
  /** Tailwind border class */
  border: string;
}

const EVENT_TYPE_META: Record<string, EventTypeMeta> = {
  // Success events — green
  build_complete:   { Icon: CheckCircle2,  text: 'text-emerald-400', bg: 'bg-emerald-500/12', border: 'border-emerald-500/20' },
  test_passed:      { Icon: CheckCircle2,  text: 'text-emerald-400', bg: 'bg-emerald-500/12', border: 'border-emerald-500/20' },
  chain_completed:  { Icon: Link,          text: 'text-emerald-400', bg: 'bg-emerald-500/12', border: 'border-emerald-500/20' },
  deploy:           { Icon: Rocket,        text: 'text-emerald-400', bg: 'bg-emerald-500/12', border: 'border-emerald-500/20' },
  // Error events — red
  test_failed:      { Icon: XCircle,       text: 'text-red-400',     bg: 'bg-red-500/12',     border: 'border-red-500/20' },
  error:            { Icon: XCircle,       text: 'text-red-400',     bg: 'bg-red-500/12',     border: 'border-red-500/20' },
  // Alert events — amber
  alert:            { Icon: AlertTriangle, text: 'text-amber-400',   bg: 'bg-amber-500/12',   border: 'border-amber-500/20' },
  // Webhook events — blue
  webhook_received: { Icon: Webhook,       text: 'text-blue-400',    bg: 'bg-blue-500/12',    border: 'border-blue-500/20' },
  // Schedule events — amber/clock
  schedule_fired:   { Icon: Clock,         text: 'text-amber-400',   bg: 'bg-amber-500/12',   border: 'border-amber-500/20' },
  // File events — cyan
  file_changed:     { Icon: FileEdit,      text: 'text-cyan-400',    bg: 'bg-cyan-500/12',    border: 'border-cyan-500/20' },
};

const DEFAULT_EVENT_META: EventTypeMeta = {
  Icon: Zap, text: 'text-violet-400', bg: 'bg-violet-500/12', border: 'border-violet-500/20',
};

function EventTypeChip({ eventType }: { eventType: string }) {
  const meta = EVENT_TYPE_META[eventType] ?? DEFAULT_EVENT_META;
  const { Icon, text, bg, border } = meta;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-mono border ${bg} ${text} ${border} truncate max-w-full`}
      title={eventType}
    >
      <Icon className="w-3 h-3 flex-shrink-0" />
      {eventType}
    </span>
  );
}

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
      const results = await Promise.all(
        personas.map((p) => eventsApi.listSubscriptions(p.id)),
      );
      setSubscriptions(results.flat());
    } catch (err) {
      console.error('Failed to fetch subscriptions:', err);
    } finally {
      setLoading(false);
    }
  }, [personas]);

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
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          </div>

          {/* Add form */}
          {adding && (
            <div className="p-4 bg-secondary/40 border border-border/30 rounded-xl space-y-3">
              <div className="grid grid-cols-3 gap-3">
                {/* Persona select */}
                <div>
                  <label className="block text-xs text-muted-foreground/80 mb-1">Agent</label>
                  <select
                    value={newPersonaId}
                    onChange={(e) => setNewPersonaId(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm bg-background/60 border border-border/40 rounded-lg text-foreground/90 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  >
                    <option value="">Select agent...</option>
                    {personas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Event type */}
                <div>
                  <label className="block text-xs text-muted-foreground/80 mb-1">Event Type</label>
                  <input
                    list="event-type-suggestions"
                    value={newEventType}
                    onChange={(e) => setNewEventType(e.target.value)}
                    placeholder="e.g. file_changed"
                    className="w-full px-2.5 py-1.5 text-sm bg-background/60 border border-border/40 rounded-lg text-foreground/90 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                  <datalist id="event-type-suggestions">
                    {COMMON_EVENT_TYPES.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>

                {/* Source filter */}
                <div>
                  <label className="block text-xs text-muted-foreground/80 mb-1">
                    Source Filter <span className="text-muted-foreground/50">(optional)</span>
                  </label>
                  <input
                    value={newSourceFilter}
                    onChange={(e) => setNewSourceFilter(e.target.value)}
                    placeholder="e.g. src/**"
                    className="w-full px-2.5 py-1.5 text-sm bg-background/60 border border-border/40 rounded-lg text-foreground/90 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => setAdding(false)}
                  className="px-3 py-1.5 text-sm text-muted-foreground/80 hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdd}
                  disabled={!newPersonaId || !newEventType.trim() || saving || !!isDuplicate}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary/15 text-primary border border-primary/25 hover:bg-primary/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saving && <Loader2 className="w-3 h-3 animate-spin" />}
                  {isDuplicate ? 'Already Subscribed' : 'Create Subscription'}
                </button>
              </div>
            </div>
          )}

          {/* Subscriptions table */}
          {subscriptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Radio className="w-8 h-8 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground/70">No event subscriptions yet</p>
              <p className="text-xs text-muted-foreground/50 mt-1">
                Subscribe agents to event types so they activate automatically
              </p>
            </div>
          ) : (
            <div className="border border-border/30 rounded-xl overflow-hidden">
              {/* Column headers */}
              <div className="grid grid-cols-[1fr_1fr_1fr_80px_40px] gap-3 px-4 py-2.5 bg-secondary/30 border-b border-border/20 text-xs font-mono text-muted-foreground/70 uppercase tracking-wider">
                <span>Agent</span>
                <span>Event Type</span>
                <span>Source Filter</span>
                <span className="text-center">Status</span>
                <span />
              </div>

              {/* Rows */}
              {subscriptions.map((sub) => {
                const busy = busyIds.has(sub.id);
                return (
                  <div
                    key={sub.id}
                    className="grid grid-cols-[1fr_1fr_1fr_80px_40px] gap-3 px-4 py-3 border-b border-border/10 last:border-b-0 items-center hover:bg-secondary/20 transition-colors"
                  >
                    <span className="text-sm text-foreground/85 truncate">
                      {personaName(sub.persona_id)}
                    </span>
                    <div className="truncate">
                      <EventTypeChip eventType={sub.event_type} />
                    </div>
                    <span className="text-sm text-muted-foreground/70 truncate">
                      {sub.source_filter ?? '\u2014'}
                    </span>
                    <div className="flex justify-center">
                      <button
                        onClick={() => handleToggle(sub)}
                        disabled={busy}
                        className={`px-2 py-0.5 text-xs font-medium rounded-md border transition-colors ${
                          sub.enabled
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/25'
                            : 'bg-secondary/60 text-muted-foreground/60 border-border/20 hover:bg-secondary/80'
                        } ${busy ? 'opacity-50 cursor-wait' : ''}`}
                      >
                        {sub.enabled ? 'On' : 'Off'}
                      </button>
                    </div>
                    <div className="flex justify-center">
                      <button
                        onClick={() => handleDelete(sub.id)}
                        disabled={busy}
                        className={`p-1 rounded-md text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10 transition-colors ${busy ? 'opacity-50 cursor-wait' : ''}`}
                        title="Delete subscription"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
