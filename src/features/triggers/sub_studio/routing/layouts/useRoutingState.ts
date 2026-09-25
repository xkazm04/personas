/**
 * Shared state for routing-view variants (Dispatch / Switchboard / Baseline).
 *
 * Centralises: initial fetch + reload, row derivation (via buildEventRows),
 * modal target state, the action handlers (link / unlink / rename /
 * backfill-handlers), and each cable's vitals + pause/resume (libs/cableVitals). Each variant provides its own filters and layout — the
 * hook keeps data and actions consistent across variants so we don't duplicate
 * ~150 lines of state glue three times while prototyping.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import {
  listAllTriggers,
  deleteTrigger,
  linkPersonaToEvent,
  unlinkPersonaFromEvent,
  renameEventType,
  updateTrigger,
  dryRunTrigger,
} from '@/api/pipeline/triggers';
import {
  listEvents,
  listAllSubscriptions,
  deleteSubscription,
  updateSubscription,
} from '@/api/overview/events';
import { buildEventRows, type EventRow, type Connection } from './routingHelpers';
import { disconnectPlan } from '../../libs/routeCodec';
import { cableVitals, indexById, pausePlan, resumePlan, summarizeCables, type ToggleCall } from '../../libs/cableVitals';
import { silentCatch, toastCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';


export interface RoutingStateProps {
  personas: Persona[];
  teams: PersonaTeam[];
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

/** First-page roster — cables don't need the whole table. */
const STUDIO_TRIGGER_LIMIT = 200;
const STUDIO_SUB_LIMIT = 200;
/** Source-label enrichment only; LiveStream uses the same page. Must not gate cables. */
const STUDIO_EVENT_LIMIT = 100;

function runToggle(call: ToggleCall): Promise<unknown> {
  return call.api === 'updateTrigger'
    ? updateTrigger(call.id, call.personaId, call.input)
    : updateSubscription(call.id, call.input);
}

/** Key of the row a toggle writes (the governing trigger or subscription). */
export function toggleKeyOf(c: Connection): string {
  return c.subscriptionId ?? c.route?.primaryTriggerId ?? c.triggerId ?? c.personaId;
}

export function useRoutingState({
  personas, teams,
}: RoutingStateProps) {
  const [allTriggers, setAllTriggers] = useState<PersonaTrigger[]>([]);
  const [recentEvents, setRecentEvents] = useState<PersonaEvent[]>([]);
  const [subscriptions, setSubscriptions] = useState<PersonaEventSubscription[]>([]);
  // Ghost vs empty is gated on triggers+subs (the two collections that produce
  // live cables). Events only enrich source labels and must not hold first paint.
  const [triggersLoading, setTriggersLoading] = useState(true);
  const [subsLoading, setSubsLoading] = useState(true);

  const [addPersonaForEvent, setAddPersonaForEvent] = useState<AddPersonaTarget | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<DisconnectTarget | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [toggling, setToggling] = useState<ReadonlySet<string>>(new Set());
  const addToast = useToastStore((s) => s.addToast);
  const { t, tx } = useTranslation();
  const st = t.triggers.studio;

  useEffect(() => {
    let stale = false;
    listAllTriggers(STUDIO_TRIGGER_LIMIT)
      .then((t) => { if (!stale) setAllTriggers(t); })
      .catch(silentCatch("features/triggers/sub_studio/routing/layouts/useRoutingState:listAllTriggers"))
      .finally(() => { if (!stale) setTriggersLoading(false); });
    listAllSubscriptions(STUDIO_SUB_LIMIT)
      .then((subs) => { if (!stale) setSubscriptions(subs); })
      .catch(silentCatch("features/triggers/sub_studio/routing/layouts/useRoutingState:listAllSubscriptions"))
      .finally(() => { if (!stale) setSubsLoading(false); });
    listEvents(STUDIO_EVENT_LIMIT)
      .then((e) => { if (!stale) setRecentEvents(e); })
      .catch(silentCatch("features/triggers/sub_studio/routing/layouts/useRoutingState:listEvents"));
    return () => { stale = true; };
  }, []);

  const reload = useCallback(async () => {
    // Land each collection as it arrives so existing cables stay on screen
    // (law 1) and a slow events page cannot hold a trigger/sub refresh.
    await Promise.all([
      listAllTriggers(STUDIO_TRIGGER_LIMIT)
        .then(setAllTriggers)
        .catch(silentCatch("features/triggers/sub_studio/routing/layouts/useRoutingState:reloadTriggers")),
      listEvents(STUDIO_EVENT_LIMIT)
        .then(setRecentEvents)
        .catch(silentCatch("features/triggers/sub_studio/routing/layouts/useRoutingState:reloadEvents")),
      listAllSubscriptions(STUDIO_SUB_LIMIT)
        .then(setSubscriptions)
        .catch(silentCatch("features/triggers/sub_studio/routing/layouts/useRoutingState:reloadSubs")),
    ]);
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

  // The governing rows behind the cables (triggers by id, subscriptions by id).
  const cableIndex = useMemo(() => indexById(allTriggers, subscriptions), [allTriggers, subscriptions]);
  const vitalsOf = useCallback((c: Connection) => cableVitals(c, cableIndex), [cableIndex]);
  const cableSummary = useMemo(
    () => summarizeCables(rows.flatMap((r) => r.connections).map(vitalsOf)),
    [rows, vitalsOf],
  );

  /**
   * Pause or resume a cable. Both are one `enabled` write on the governing row
   * and delete nothing. Resume first dry-runs the trigger (the gate a new chain
   * commit walks in useStudioComposer.commitLink), so a route whose source went
   * away while it sat paused stays paused and says why.
   */
  const handleSetPaused = useCallback(async (connection: Connection, paused: boolean) => {
    const key = toggleKeyOf(connection);
    setToggling((s) => new Set(s).add(key));
    try {
      if (paused) {
        const call = pausePlan(connection);
        if (call) await runToggle(call);
      } else {
        const plan = resumePlan(connection);
        if (!plan) return;
        if (plan.dryRunId) {
          const dry = await dryRunTrigger(plan.dryRunId);
          if (!dry.valid) {
            const failed = dry.validation.checks.find((c) => !c.passed);
            addToast(tx(st.resume_dry_run_failed, { error: failed?.message ?? '' }), 'error');
            return;
          }
        }
        await runToggle(plan.call);
      }
      await reload();
    } catch (err) {
      toastCatch('features/triggers/sub_studio/routing/layouts/useRoutingState:setPaused', st.route_toggle_failed)(err);
    } finally {
      setToggling((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  }, [reload, addToast, tx, st.resume_dry_run_failed, st.route_toggle_failed]);

  const handleAddPersona = useCallback(
    async (personaId: string, useCaseId: string | null) => {
      if (!addPersonaForEvent) return;
      const { eventType } = addPersonaForEvent;
      setAddPersonaForEvent(null);
      try {
        await linkPersonaToEvent(personaId, eventType, { useCaseId });
        await reload();
      } catch (err) { silentCatch("features/triggers/sub_studio/routing/layouts/useRoutingState:catch3")(err); }
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
      // Runs only as the DisconnectDialog's confirm. A trigger-backed cable is
      // removed as a whole route (routeCodec.disconnectPlan): a signal route
      // deletes its source trigger and the backend cascades the auto-listener.
      if (connection.kind === 'subscription' && connection.subscriptionId) {
        await deleteSubscription(connection.subscriptionId);
      } else if (connection.route) {
        const plan = disconnectPlan(connection.route);
        if (plan.call === 'deleteTrigger') await deleteTrigger(plan.id, plan.personaId);
        else await unlinkPersonaFromEvent(plan.triggerId);
      }
      await reload();
    } catch (err) { silentCatch("features/triggers/sub_studio/routing/layouts/useRoutingState:catch4")(err); }
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
    personas, teams, personaMap,
    rows, recentEvents,
    loading: triggersLoading || subsLoading,
    reload,
    addPersonaForEvent, setAddPersonaForEvent,
    disconnectTarget, setDisconnectTarget,
    renameTarget, setRenameTarget,
    handleAddPersona, handleRename, handleDisconnect,
    connectedPersonaIdsForRow,
    vitalsOf, cableSummary, handleSetPaused, toggling,
  };
}

export type RoutingState = ReturnType<typeof useRoutingState>;
