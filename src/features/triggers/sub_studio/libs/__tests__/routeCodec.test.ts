/**
 * The Chain Studio route codec, asserted THROUGH THE READER.
 *
 * The Studio writes a route as one or two trigger rows (studioCommit /
 * the configure-&-commit form); the ledger reads it back from those rows. The
 * two directions used to be unrelated hand mappings, so a saved Schedule -> B
 * route came back as an anonymous listener on the shared `trigger_fired` row,
 * a file_watcher route never came back at all, and a jsonpath chain came back
 * labelled "always". These cases pin that the reader is the write side's
 * inverse: what the Studio writes, the ledger shows, one cable per route.
 *
 * `simulatedRowsFor` stands in for the backend create path, including the
 * auto-listener it adds for schedule / polling / webhook
 * (db/src/repos/resources/triggers/definitions.rs, AUTO_LISTENER_SOURCE_TYPES
 * and build_auto_listener_config).
 */
import { describe, it, expect } from 'vitest';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { CreateTriggerInput } from '@/lib/bindings/CreateTriggerInput';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import type { DraftLink, LinkCondition } from '../studioDraftModel';
import {
  triggersToRoutes, disconnectPlan, draftLinkToTriggerInput, formConfigToTriggerInput,
  FORM_COMMITTABLE_SOURCE_TYPES,
} from '../routeCodec';
import { conditionLabel } from '../studioLabels';
import { buildEventRows } from '../../routing/layouts/buildEventRows';

// ── fixtures ────────────────────────────────────────────────────────────

function row(id: string, personaId: string, triggerType: string, config: Record<string, unknown> | null): PersonaTrigger {
  return {
    id, persona_id: personaId, trigger_type: triggerType,
    config: config ? JSON.stringify(config) : null,
    enabled: true, status: 'active', last_triggered_at: null, next_trigger_at: null,
    trigger_version: 0, created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z',
    use_case_id: null, responsibility_id: null, unattended_mode: 'auto',
  };
}

const autoListener = (id: string, personaId: string, sourceId: string, eventType = 'trigger_fired') =>
  row(id, personaId, 'event_listener', { listen_event_type: eventType, source_filter: sourceId, _auto_for_trigger: sourceId });

const AUTO_LISTENER_SOURCE_TYPES = new Set(['schedule', 'polling', 'webhook']);

/** The rows the backend create path leaves behind for one create_trigger input. */
function simulatedRowsFor(input: CreateTriggerInput, id: string): PersonaTrigger[] {
  // Both write-side builders stringify a plain object, so the parse is one.
  const cfg: Record<string, unknown> | null = input.config ? JSON.parse(input.config) : null;
  const primary = row(id, input.persona_id, input.trigger_type, cfg);
  if (!AUTO_LISTENER_SOURCE_TYPES.has(input.trigger_type)) return [primary];
  // TriggerConfig::event_type(): an event_type-less config publishes trigger_fired.
  const et = typeof cfg?.event_type === 'string' ? cfg.event_type : 'trigger_fired';
  return [primary, autoListener(`${id}-auto`, input.persona_id, id, et)];
}

/** One representative config per form-committable type (what TriggerAddForm collects). */
const FORM_CONFIGS: Record<string, Record<string, unknown>> = {
  schedule: { cron: '0 3 * * 1', timezone: 'Europe/Prague' },
  polling: { url: 'https://example.com/feed', interval_seconds: 300 },
  webhook: { webhook_secret: 's3cret' },
  event_listener: { listen_event_type: 'deploy_done' },
  file_watcher: { watch_paths: ['C:/inbox'], events: ['create'], recursive: true },
  clipboard: { content_type: 'text', pattern: 'error', interval_seconds: 3 },
  app_focus: { app_names: ['code.exe'], interval_seconds: 5 },
  composite: { conditions: [{ event_type: 'a' }, { event_type: 'b' }], operator: 'all', window_seconds: 60 },
};

const personaMap = new Map<string, Persona>([
  ['A', { id: 'A', name: 'A' } as Persona], // fixture: buildEventRows only asks personaMap.has / get for identity
]);

/** The ledger's cables: every connection buildEventRows derives. */
function cablesFor(triggers: PersonaTrigger[], subs: PersonaEventSubscription[] = [], events: PersonaEvent[] = []) {
  return buildEventRows(triggers, events, subs, personaMap).flatMap((r) => r.connections.map((c) => ({ row: r, c })));
}

/** Compare a read-back route to the link that wrote it. A marketplace label is
 *  presentation the feed catalog supplies; the route itself is keyed by slug. */
function linkShape(l: { source: DraftLink['source']; targetPersonaId: string; condition: LinkCondition; outputMatch?: { path: string; expected: string } }) {
  const source = l.source.kind === 'marketplace' ? { kind: 'marketplace', slug: l.source.slug } : l.source;
  return { source, targetPersonaId: l.targetPersonaId, condition: l.condition, outputMatch: l.outputMatch };
}

// ── case 1 ──────────────────────────────────────────────────────────────

describe('triggersToRoutes', () => {
  it('case 1: folds an auto-listener into its schedule trigger - one route, never a route of its own', () => {
    const routes = triggersToRoutes([row('S', 'B', 'schedule', { cron: '0 3 * * 1' }), autoListener('L', 'B', 'S')]);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      source: { kind: 'trigger', triggerType: 'schedule' },
      targetPersonaId: 'B',
      primaryTriggerId: 'S',
      triggerIds: ['S', 'L'],
      condition: null,
      enabled: true,
    });
    expect(routes.some((r) => r.primaryTriggerId === 'L')).toBe(false);
  });

  it('case 1 (order): the fold does not depend on the listener arriving after its source', () => {
    const routes = triggersToRoutes([autoListener('L', 'B', 'S'), row('S', 'B', 'schedule', { cron: '0 3 * * 1' })]);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ primaryTriggerId: 'S', triggerIds: ['S', 'L'] });
  });

  // ── case 2 ────────────────────────────────────────────────────────────

  it('case 2: two schedule triggers into one persona are two routes and two cables', () => {
    const triggers = [
      row('S1', 'B', 'schedule', { cron: '0 3 * * 1' }), autoListener('L1', 'B', 'S1'),
      row('S2', 'B', 'schedule', { cron: '0 9 * * *' }), autoListener('L2', 'B', 'S2'),
    ];
    const routes = triggersToRoutes(triggers);
    expect(routes.map((r) => r.primaryTriggerId)).toEqual(['S1', 'S2']);

    const cables = cablesFor(triggers);
    expect(cables).toHaveLength(2);
    expect(cables.map(({ c }) => c.route?.primaryTriggerId).sort()).toEqual(['S1', 'S2']);
    expect(cables.every(({ c }) => c.personaId === 'B')).toBe(true);
  });

  // ── case 3 ────────────────────────────────────────────────────────────

  it.each(['file_watcher', 'clipboard', 'app_focus', 'composite'])(
    'case 3: a %s trigger with no auto-listener is still one route and one cable',
    (type) => {
      const triggers = [row('F', 'B', type, FORM_CONFIGS[type]!)];
      const routes = triggersToRoutes(triggers);
      expect(routes).toHaveLength(1);
      expect(routes[0]).toMatchObject({
        source: { kind: 'trigger', triggerType: type }, targetPersonaId: 'B', primaryTriggerId: 'F', triggerIds: ['F'],
      });
      const cables = cablesFor(triggers);
      expect(cables).toHaveLength(1);
      expect(cables[0]!.c.route?.source).toEqual({ kind: 'trigger', triggerType: type });
    },
  );

  // ── case 4 ────────────────────────────────────────────────────────────

  it('case 4: a jsonpath chain reads back as output_match with its path, and is labelled so', () => {
    const routes = triggersToRoutes([row('C', 'B', 'chain', {
      source_persona_id: 'A', condition: { type: 'jsonpath', jsonpath: '$.a', expected: 'x' }, event_type: 'chain_triggered',
    })]);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      source: { kind: 'persona', personaId: 'A' }, targetPersonaId: 'B',
      condition: 'output_match', outputMatch: { path: '$.a', expected: 'x' },
    });
    const t = { triggers: { studio: {
      condition_on_success: 'condition_on_success', condition_on_failure: 'condition_on_failure',
      condition_output_match: 'condition_output_match', condition_always: 'condition_always',
    } } } as unknown as Parameters<typeof conditionLabel>[0]; // test double: only the four condition keys are read
    expect(conditionLabel(t, routes[0]!.condition)).toBe('condition_output_match');

    const cables = cablesFor([row('C', 'B', 'chain', { source_persona_id: 'A', condition: { type: 'jsonpath', jsonpath: '$.a', expected: 'x' } })]);
    expect(cables).toHaveLength(1);
    expect(cables[0]!.c.route?.condition).toBe('output_match');
  });

  // ── case 5 ────────────────────────────────────────────────────────────

  it('case 5: every committable link round-trips through the backend rows and the reader', () => {
    const links: DraftLink[] = [];
    for (const condition of [null, 'on_success', 'on_failure', 'output_match'] as LinkCondition[]) {
      links.push({
        id: `p-${condition}`, source: { kind: 'persona', personaId: 'A' }, targetPersonaId: 'B', condition,
        ...(condition === 'output_match' ? { outputMatch: { path: '$.result.status', expected: 'approved' } } : {}),
      });
    }
    links.push({ id: 'm', source: { kind: 'marketplace', slug: 'acme', label: 'Acme feed' }, targetPersonaId: 'B', condition: null });
    for (const type of FORM_COMMITTABLE_SOURCE_TYPES) {
      links.push({ id: `f-${type}`, source: { kind: 'trigger', triggerType: type }, targetPersonaId: 'B', condition: null });
    }
    expect(links).toHaveLength(4 + 1 + 8);

    for (const link of links) {
      const input = link.source.kind === 'trigger'
        ? formConfigToTriggerInput(link, link.source.triggerType, FORM_CONFIGS[link.source.triggerType]!)
        : draftLinkToTriggerInput(link);
      expect(input, link.id).not.toBeNull();
      const routes = triggersToRoutes(simulatedRowsFor(input!, `t-${link.id}`));
      expect(routes, link.id).toHaveLength(1);
      expect(linkShape(routes[0]!), link.id).toEqual(linkShape(link));
      expect(routes[0]!.primaryTriggerId, link.id).toBe(`t-${link.id}`);
    }
  });

  // ── case 6 ────────────────────────────────────────────────────────────

  it('case 6: disconnecting a folded signal route deletes its source trigger, not the listener', () => {
    const [route] = triggersToRoutes([row('S', 'B', 'schedule', { cron: '0 3 * * 1' }), autoListener('L', 'B', 'S')]);
    expect(disconnectPlan(route!)).toEqual({ call: 'deleteTrigger', id: 'S', personaId: 'B' });
  });

  it('case 6 (chain): a chain route deletes its chain trigger on the target persona', () => {
    const [route] = triggersToRoutes([row('C', 'B', 'chain', { source_persona_id: 'A', condition: { type: 'any' } })]);
    expect(disconnectPlan(route!)).toEqual({ call: 'deleteTrigger', id: 'C', personaId: 'B' });
  });

  // ── guards ────────────────────────────────────────────────────────────

  it('[guard] a marketplace listener reads back with a marketplace source; unlinking keeps the listener path', () => {
    const [route] = triggersToRoutes([row('M', 'B', 'event_listener', { listen_event_type: 'shared:acme' })]);
    expect(route!.source).toMatchObject({ kind: 'marketplace', slug: 'acme' });
    expect(route!.eventType).toBe('shared:acme');
    expect(disconnectPlan(route!)).toEqual({ call: 'unlinkPersonaFromEvent', triggerId: 'M' });
  });

  it('[guard] persona-to-persona subscription connections (buildEventRows step 4) are unchanged', () => {
    const sub = (id: string, personaId: string, eventType: string): PersonaEventSubscription => ({
      id, persona_id: personaId, event_type: eventType, source_filter: null, enabled: true,
      use_case_id: null, created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z',
    });
    // Persona A has emitted report_ready, so B's subscription reads as a listener.
    const emitted = { event_type: 'report_ready', source_id: 'A', source_type: 'persona' } as PersonaEvent; // fixture: step 3 reads event_type / source_id / source_type only
    const cables = cablesFor([], [sub('sub-1', 'B', 'report_ready')], [emitted]);
    expect(cables).toHaveLength(1);
    expect(cables[0]!.c).toMatchObject({ kind: 'subscription', subscriptionId: 'sub-1', personaId: 'B', triggerId: null });
    expect(cables[0]!.row.eventType).toBe('report_ready');
    expect(cables[0]!.row.sourcePersonas.map((p) => p.personaId)).toEqual(['A']);
  });
});
