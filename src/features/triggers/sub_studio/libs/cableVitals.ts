/**
 * cableVitals — whether a live cable actually runs, when it last fired, and
 * the exact write that pauses or resumes it.
 *
 * The governing row of a cable is the one the runtime consults:
 *  · a trigger-backed cable -> its route's `primaryTriggerId` (routeCodec).
 *    For a signal route that is the source trigger; its auto-listener is folded
 *    into the route and never governs it.
 *  · a legacy subscription cable -> its persona_event_subscriptions row.
 *
 * "Live" mirrors the runtime predicates: triggers are armed only when
 * `status = 'active'` (db/.../triggers/scheduling.rs get_enabled_by_type,
 * get_event_listeners_for_event_type, get_chain_triggers_for_source), and
 * subscriptions dispatch only when `enabled = 1` (repos/communication/events.rs
 * get_subscriptions_by_event_type). Everything else is drawn and counted as
 * paused - including a chain a commit left disabled mid-flight.
 *
 * Pause and resume flip `enabled` on the governing row and delete nothing, so
 * the hourly backfill_auto_listeners sweep (it recreates only MISSING
 * listeners) has nothing to resurrect. `update_trigger` derives `status` from
 * `enabled`. A trigger resume is gated by a dry-run of that trigger.
 */
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import type { Connection } from '../routing/layouts/routingHelpers';

export type CableState = 'live' | 'paused';

export interface CableVitals {
  state: CableState;
  /** `last_triggered_at` of the governing trigger; null = never fired. */
  lastFiredAt: string | null;
  /**
   * False when the backend never records a fire for this route kind, so the
   * cable must show no pulse at all rather than a fabricated "never fired".
   */
  firesTracked: boolean;
}

export interface CableIndex {
  triggersById: ReadonlyMap<string, PersonaTrigger>;
  subsById: ReadonlyMap<string, PersonaEventSubscription>;
}

export type ToggleCall =
  | { api: 'updateTrigger'; id: string; personaId: string; input: { enabled: boolean } }
  | { api: 'updateSubscription'; id: string; input: { event_type: null; source_filter: null; enabled: boolean } };

export interface ResumePlan {
  /** Trigger to dry-run before the call; null when there is nothing to dry-run (a subscription). */
  dryRunId: string | null;
  call: ToggleCall;
}

/**
 * Trigger types whose fire writes `last_triggered_at`: chain (db/src/chain.rs
 * mark_triggered), schedule (engine/background/scheduler.rs), polling
 * (engine/polling.rs) and webhook (engine/webhook.rs). Nothing else does.
 */
const FIRE_TRACKED_TYPES: ReadonlySet<string> = new Set(['chain', 'schedule', 'polling', 'webhook']);

export function indexById(
  triggers: readonly PersonaTrigger[],
  subscriptions: readonly PersonaEventSubscription[],
): CableIndex {
  return {
    triggersById: new Map(triggers.map((t) => [t.id, t])),
    subsById: new Map(subscriptions.map((s) => [s.id, s])),
  };
}

function isSubscription(c: Connection): c is Connection & { subscriptionId: string } {
  return c.kind === 'subscription' && !!c.subscriptionId;
}

export function cableVitals(connection: Connection, index: CableIndex): CableVitals {
  if (isSubscription(connection)) {
    const sub = index.subsById.get(connection.subscriptionId);
    return { state: sub && !sub.enabled ? 'paused' : 'live', lastFiredAt: null, firesTracked: false };
  }
  const route = connection.route;
  const row = route ? index.triggersById.get(route.primaryTriggerId) : undefined;
  if (!row) {
    // Not in the loaded page: trust what the codec decoded, claim no pulse.
    return { state: route && !route.enabled ? 'paused' : 'live', lastFiredAt: null, firesTracked: false };
  }
  return {
    state: row.enabled && row.status === 'active' ? 'live' : 'paused',
    lastFiredAt: row.last_triggered_at ?? null,
    firesTracked: FIRE_TRACKED_TYPES.has(row.trigger_type),
  };
}

export function summarizeCables(vitals: readonly CableVitals[]): { live: number; paused: number } {
  let live = 0;
  for (const v of vitals) if (v.state === 'live') live += 1;
  return { live, paused: vitals.length - live };
}

function toggleCall(connection: Connection, enabled: boolean): ToggleCall | null {
  if (isSubscription(connection)) {
    return { api: 'updateSubscription', id: connection.subscriptionId, input: { event_type: null, source_filter: null, enabled } };
  }
  const route = connection.route;
  if (!route) return null;
  return { api: 'updateTrigger', id: route.primaryTriggerId, personaId: route.targetPersonaId, input: { enabled } };
}

/** The one write that pauses a cable: `enabled = false` on its governing row. */
export function pausePlan(connection: Connection): ToggleCall | null {
  return toggleCall(connection, false);
}

/** Resume = dry-run the governing trigger, then `enabled = true` on it. */
export function resumePlan(connection: Connection): ResumePlan | null {
  const call = toggleCall(connection, true);
  if (!call) return null;
  return { dryRunId: call.api === 'updateTrigger' ? call.id : null, call };
}
