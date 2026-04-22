/**
 * Shared state for routing-view variants (Dispatch / Switchboard / Baseline).
 *
 * Centralises: initial fetch + reload, row derivation (via buildEventRows),
 * modal target state, and the three action handlers (link / unlink / rename /
 * backfill-handlers). Each variant provides its own filters and layout — the
 * hook keeps data and actions consistent across variants so we don't duplicate
 * ~150 lines of state glue three times while prototyping.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaGroup } from '@/lib/bindings/PersonaGroup';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import {
  listAllTriggers,
  deleteTrigger,
  linkPersonaToEvent,
  unlinkPersonaFromEvent,
  initializeEventHandlersForPersona,
  renameEventType,
} from '@/api/pipeline/triggers';
import {
  listEvents,
  listAllSubscriptions,
  deleteSubscription,
} from '@/api/overview/events';
import { buildEventRows, type EventRow, type Connection } from './routingHelpers';

export interface RoutingStateProps {
  initialTriggers: PersonaTrigger[];
  initialEvents: PersonaEvent[];
  personas: Persona[];
  groups: PersonaGroup[];
}

export interface AddPersonaTarget { eventType: string }
export interface DisconnectTarget {
  connection: Connection;
  personaName: string;
  eventLabel: string;
}
export interface RenameTarget {
  eventType: string;
  reserved: boolean;
  sources: number;
  connections: number;
}

export function useRoutingState({
  initialTriggers, initialEvents, personas, groups,
}: RoutingStateProps) {
  const [allTriggers, setAllTriggers] = useState<PersonaTrigger[]>(initialTriggers);
  const [recentEvents, setRecentEvents] = useState<PersonaEvent[]>(initialEvents);
  const [subscriptions, setSubscriptions] = useState<PersonaEventSubscription[]>([]);

  const [addPersonaForEvent, setAddPersonaForEvent] = useState<AddPersonaTarget | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<DisconnectTarget | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [isBackfilling, setIsBackfilling] = useState(false);

  useEffect(() => { setAllTriggers(initialTriggers); }, [initialTriggers]);
  useEffect(() => { setRecentEvents(initialEvents); }, [initialEvents]);

  useEffect(() => {
    let stale = false;
    listAllSubscriptions()
      .then(subs => { if (!stale) setSubscriptions(subs); })
      .catch(() => { /* non-critical */ });
    return () => { stale = true; };
  }, []);

  const reload = useCallback(async () => {
    try {
      const [t, e, s] = await Promise.all([
        listAllTriggers(),
        listEvents(1000).catch(() => [] as PersonaEvent[]),
        listAllSubscriptions().catch(() => [] as PersonaEventSubscription[]),
      ]);
      setAllTriggers(t);
      setRecentEvents(e);
      setSubscriptions(s);
    } catch { /* best-effort */ }
  }, []);

  const personaMap = useMemo(() => {
    const m = new Map<string, Persona>();
    for (const p of personas) m.set(p.id, p);
    return m;
  }, [personas]);

  const rows: EventRow[] = useMemo(
    () => buildEventRows(allTriggers, recentEvents, subscriptions, personaMap),
    [allTriggers, recentEvents, subscriptions, personaMap],
  );

  const handleInitializeHandlers = useCallback(async () => {
    setIsBackfilling(true);
    try {
      const personaIds = new Set<string>();
      for (const t of allTriggers) {
        if (t.trigger_type === 'event_listener') personaIds.add(t.persona_id);
      }
      for (const sub of subscriptions) personaIds.add(sub.persona_id);
      let total = 0;
      for (const pid of personaIds) {
        try {
          total += await initializeEventHandlersForPersona(pid);
        } catch { /* best-effort per persona */ }
      }
      // eslint-disable-next-line no-console
      console.info(`[builder] initialized ${total} event handler entries across ${personaIds.size} personas`);
      await reload();
    } finally {
      setIsBackfilling(false);
    }
  }, [allTriggers, subscriptions, reload]);

  const handleAddPersona = useCallback(
    async (personaId: string, useCaseId: string | null) => {
      if (!addPersonaForEvent) return;
      const { eventType } = addPersonaForEvent;
      setAddPersonaForEvent(null);
      try {
        await linkPersonaToEvent(personaId, eventType, { useCaseId });
        await reload();
      } catch { /* best-effort */ }
    },
    [addPersonaForEvent, reload],
  );

  const handleRename = useCallback(
    async (newEventType: string) => {
      if (!renameTarget) return;
      await renameEventType(renameTarget.eventType, newEventType);
      setRenameTarget(null);
      await reload();
    },
    [renameTarget, reload],
  );

  const handleDisconnect = useCallback(async () => {
    if (!disconnectTarget) return;
    const { connection } = disconnectTarget;
    try {
      if (connection.kind === 'subscription' && connection.subscriptionId) {
        await deleteSubscription(connection.subscriptionId);
      } else if (connection.kind === 'trigger-listener' && connection.triggerId) {
        await unlinkPersonaFromEvent(connection.triggerId);
      } else if (connection.triggerId) {
        await deleteTrigger(connection.triggerId, connection.personaId);
      }
      await reload();
    } catch { /* best-effort */ }
    setDisconnectTarget(null);
  }, [disconnectTarget, reload]);

  const connectedPersonaIdsForRow = useMemo(() => {
    if (!addPersonaForEvent) return new Set<string>();
    const row = rows.find(r => r.eventType === addPersonaForEvent.eventType);
    if (!row) return new Set<string>();
    const ids = new Set<string>(row.connections.map(c => c.personaId));
    for (const s of row.sourcePersonas) ids.add(s.personaId);
    return ids;
  }, [addPersonaForEvent, rows]);

  return {
    personas, groups, personaMap,
    rows, recentEvents,
    reload,
    isBackfilling, handleInitializeHandlers,
    addPersonaForEvent, setAddPersonaForEvent,
    disconnectTarget, setDisconnectTarget,
    renameTarget, setRenameTarget,
    handleAddPersona, handleRename, handleDisconnect,
    connectedPersonaIdsForRow,
  };
}

export type RoutingState = ReturnType<typeof useRoutingState>;
