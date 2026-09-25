/**
 * routeCodec — the Chain Studio's one mapping between a route and the trigger
 * rows that implement it, in BOTH directions.
 *
 * Write side (moved here from studioCommit, which re-exports it):
 *  · persona -> persona  = a `chain` trigger on the TARGET, `source_persona_id`
 *    = the source, the link condition as the backend ChainCondition
 *    (any / success / failure / jsonpath; engine/chain.rs names the path field
 *    literally "jsonpath").
 *  · marketplace feed    = an `event_listener` on the target for `shared:<slug>`.
 *  · signal source       = a trigger of that type on the target, config from the
 *    configure-&-commit form. For schedule / polling / webhook the backend also
 *    inserts a paired auto-listener carrying `_auto_for_trigger` = the source id
 *    (db/.../triggers/definitions.rs, AUTO_LISTENER_SOURCE_TYPES).
 *
 * Read side (`triggersToRoutes`) is the inverse over the stored rows: each
 * auto-listener folds into the trigger it was minted for, and every committed
 * trigger of a Studio-committable type becomes exactly ONE route. The ledger
 * must never infer a route from a wiring side effect (an anonymous listener on
 * the shared `trigger_fired` row) - that is how the picture and the runtime
 * drifted apart. `disconnectPlan` says how to remove a route as a whole.
 */
import type { CreateTriggerInput } from '@/lib/bindings/CreateTriggerInput';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import { parseTriggerConfig } from '@/lib/utils/platform/triggerConstants';
import type { DraftLink, DraftSource, LinkCondition } from './studioDraftModel';

/**
 * Signal-source trigger types whose per-type config the full trigger form can
 * collect — these commit through the configure-&-commit modal. `chain` is
 * excluded (a chain source IS a persona-completion source: arm the persona
 * instead); `manual` is excluded (nothing to trigger on).
 */
export const FORM_COMMITTABLE_SOURCE_TYPES: ReadonlySet<string> = new Set([
  'schedule',
  'polling',
  'webhook',
  'event_listener',
  'file_watcher',
  'clipboard',
  'app_focus',
  'composite',
]);

/** Bus event a Marketplace feed relay publishes: `shared:<slug>`. */
const MARKETPLACE_EVENT_PREFIX = 'shared:';
/** TriggerConfig::event_type() default (core/src/models/trigger.rs). */
const DEFAULT_FIRED_EVENT = 'trigger_fired';
const DEFAULT_CHAIN_EVENT = 'chain_triggered';

/** A committed route, shaped like the DraftLink that wrote it. */
export interface LiveRoute {
  source: DraftSource;
  targetPersonaId: string;
  condition: LinkCondition;
  outputMatch?: { path: string; expected: string };
  /** The trigger that governs the route: deleting / pausing it acts on the whole route. */
  primaryTriggerId: string;
  /** Every row the route owns: the primary first, then its folded auto-listener(s). */
  triggerIds: string[];
  enabled: boolean;
  /** The bus event row the route rides on in the ledger. */
  eventType: string;
  useCaseId: string | null;
}

export type DisconnectPlan =
  | { call: 'deleteTrigger'; id: string; personaId: string }
  | { call: 'unlinkPersonaFromEvent'; triggerId: string };

// ── write side ──────────────────────────────────────────────────────────

/** LinkCondition (+ outputMatch) -> backend ChainCondition; null when incomplete. */
export function linkConditionToChain(link: Pick<DraftLink, 'condition' | 'outputMatch'>): Record<string, unknown> | null {
  switch (link.condition) {
    case 'on_success': return { type: 'success' };
    case 'on_failure': return { type: 'failure' };
    case 'output_match': {
      const om = link.outputMatch;
      if (!om || !om.path.trim() || !om.expected.trim()) return null;
      // Unresolvable paths log + treat as non-matching (engine/chain.rs).
      return { type: 'jsonpath', jsonpath: om.path.trim(), expected: om.expected.trim() };
    }
    case null: return { type: 'any' };
    default: return null;
  }
}

/**
 * Build the `create_trigger` input for a directly-committable link (persona
 * source or Marketplace feed). Returns `null` for signal sources, which go
 * through the configure-&-commit modal ({@link formConfigToTriggerInput}).
 */
export function draftLinkToTriggerInput(link: DraftLink): CreateTriggerInput | null {
  if (link.source.kind === 'marketplace') {
    return {
      persona_id: link.targetPersonaId,
      trigger_type: 'event_listener',
      config: JSON.stringify({ listen_event_type: `${MARKETPLACE_EVENT_PREFIX}${link.source.slug}` }),
      enabled: true,
      use_case_id: null,
    };
  }
  if (link.source.kind !== 'persona') return null;
  const condition = linkConditionToChain(link);
  if (!condition) return null;
  return {
    persona_id: link.targetPersonaId,
    trigger_type: 'chain',
    config: JSON.stringify({
      source_persona_id: link.source.personaId,
      condition,
      event_type: DEFAULT_CHAIN_EVENT,
      // The engine only injects `source_output` into the next step when this is
      // true (engine/chain.rs); without it the target gets no upstream payload
      // (UAT L1 F-CHAIN-NO-PAYLOAD-FORWARD).
      payload_forward: true,
    }),
    enabled: true,
    use_case_id: null,
  };
}

/** Signal-source link: the form-collected config becomes a trigger of the source's type on the TARGET. */
export function formConfigToTriggerInput(
  link: DraftLink,
  triggerType: string,
  config: Record<string, unknown>,
): CreateTriggerInput {
  return {
    persona_id: link.targetPersonaId,
    trigger_type: triggerType,
    config: JSON.stringify(config),
    enabled: true,
    use_case_id: null,
  };
}

// ── read side ───────────────────────────────────────────────────────────

/** Backend ChainCondition -> LinkCondition (+ outputMatch). Unknown shapes read as "any". */
export function chainConditionToLink(cond: unknown): Pick<LiveRoute, 'condition' | 'outputMatch'> {
  const c = (cond && typeof cond === 'object' ? cond : {}) as Record<string, unknown>;
  switch (c.type) {
    case 'success': return { condition: 'on_success' };
    case 'failure': return { condition: 'on_failure' };
    case 'jsonpath': return {
      condition: 'output_match',
      outputMatch: {
        path: typeof c.jsonpath === 'string' ? c.jsonpath : '',
        expected: typeof c.expected === 'string' ? c.expected : '',
      },
    };
    default: return { condition: null };
  }
}

/**
 * The source trigger an auto-listener was minted for, or null for a listener
 * the user created. `_auto_for_trigger` is an advisory key the typed
 * parseTriggerConfig does not surface; it is never encrypted (only
 * SENSITIVE_TRIGGER_KEYS are), which delete_auto_listeners_for relies on too.
 */
function autoListenerSourceOf(t: PersonaTrigger): string | null {
  if (t.trigger_type !== 'event_listener' || !t.config) return null;
  try {
    const raw: unknown = JSON.parse(t.config);
    if (!raw || typeof raw !== 'object') return null;
    const v = (raw as Record<string, unknown>)._auto_for_trigger;
    return typeof v === 'string' && v ? v : null;
  } catch {
    // intentional: a corrupt config is not an auto-listener
    return null;
  }
}

function base(t: PersonaTrigger): Pick<LiveRoute, 'targetPersonaId' | 'primaryTriggerId' | 'triggerIds' | 'enabled' | 'useCaseId'> {
  return { targetPersonaId: t.persona_id, primaryTriggerId: t.id, triggerIds: [t.id], enabled: t.enabled, useCaseId: t.use_case_id ?? null };
}

/**
 * One route per committed trigger of a Studio-committable type, in input
 * order. Auto-listeners are folded into their source; an auto-listener whose
 * source is not in `triggers` is dropped (it belongs to that source, and the
 * cleanup sweep removes true orphans).
 */
export function triggersToRoutes(triggers: readonly PersonaTrigger[]): LiveRoute[] {
  const listenersBySource = new Map<string, PersonaTrigger[]>();
  for (const t of triggers) {
    const src = autoListenerSourceOf(t);
    if (src) listenersBySource.set(src, [...(listenersBySource.get(src) ?? []), t]);
  }

  const routes: LiveRoute[] = [];
  for (const t of triggers) {
    if (autoListenerSourceOf(t)) continue;
    const cfg = parseTriggerConfig(t.trigger_type, t.config);
    if (cfg.type === 'chain') {
      if (!cfg.source_persona_id) continue;
      routes.push({
        ...base(t),
        source: { kind: 'persona', personaId: cfg.source_persona_id },
        ...chainConditionToLink(cfg.condition),
        eventType: cfg.event_type || DEFAULT_CHAIN_EVENT,
      });
    } else if (cfg.type === 'event_listener') {
      const et = cfg.listen_event_type;
      if (!et) continue;
      const slug = et.startsWith(MARKETPLACE_EVENT_PREFIX) ? et.slice(MARKETPLACE_EVENT_PREFIX.length) : null;
      routes.push({
        ...base(t),
        source: slug ? { kind: 'marketplace', slug, label: slug } : { kind: 'trigger', triggerType: 'event_listener' },
        condition: null,
        eventType: et,
      });
    } else if (FORM_COMMITTABLE_SOURCE_TYPES.has(t.trigger_type)) {
      const listeners = listenersBySource.get(t.id) ?? [];
      const listened = listeners.length > 0 ? parseTriggerConfig('event_listener', listeners[0]!.config) : null;
      const own = 'event_type' in cfg ? cfg.event_type : undefined;
      routes.push({
        ...base(t),
        triggerIds: [t.id, ...listeners.map((l) => l.id)],
        source: { kind: 'trigger', triggerType: t.trigger_type },
        condition: null,
        eventType: (listened?.type === 'event_listener' ? listened.listen_event_type : undefined) || own || DEFAULT_FIRED_EVENT,
      });
    }
  }
  return routes;
}

/** A listener route: a user-created event_listener or a Marketplace feed. */
export function isListenerRoute(route: Pick<LiveRoute, 'source'>): boolean {
  return route.source.kind === 'marketplace'
    || (route.source.kind === 'trigger' && route.source.triggerType === 'event_listener');
}

/**
 * How to remove a route as a whole. A listener route unlinks through the
 * listener path, which also clears its event handler. Everything else deletes
 * the primary trigger; the backend cascades its auto-listener
 * (commands/tools/triggers.rs delete_trigger), so the hourly backfill has
 * nothing to resurrect.
 */
export function disconnectPlan(route: LiveRoute): DisconnectPlan {
  return isListenerRoute(route)
    ? { call: 'unlinkPersonaFromEvent', triggerId: route.primaryTriggerId }
    : { call: 'deleteTrigger', id: route.primaryTriggerId, personaId: route.targetPersonaId };
}
