/**
 * A live cable tells the truth about whether it runs and when it last fired,
 * and its pause verb is a write that deletes nothing.
 *
 * The Studio ledger drew every committed route as a solid "live" cable and
 * counted it in the header, although a chain can sit disabled (paused in the
 * trigger editor, or left behind when a commit threw between create-disabled
 * and enable). The only verb on a cable was Disconnect, which deletes. These
 * cases pin the pure model behind the fix: the governing row of a cable is the
 * route's `primaryTriggerId` (routeCodec) or its subscription, the state reads
 * what the runtime reads (`status = 'active'`, scheduling.rs), and a pause /
 * resume is an `enabled` flip on exactly that row.
 *
 * Connections are built through the real reader (buildEventRows over
 * routeCodec), so an auto-listener is folded exactly as the ledger folds it.
 */
import { describe, it, expect } from 'vitest';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';
import { buildEventRows } from '../../routing/layouts/buildEventRows';
import type { Connection } from '../../routing/layouts/routingHelpers';
import { cableVitals, summarizeCables, pausePlan, resumePlan, indexById } from '../cableVitals';

function trig(id: string, personaId: string, triggerType: string, config: Record<string, unknown>, extra: Partial<PersonaTrigger> = {}): PersonaTrigger {
  return {
    id, persona_id: personaId, trigger_type: triggerType, config: JSON.stringify(config),
    enabled: true, status: 'active', last_triggered_at: null, next_trigger_at: null,
    trigger_version: 0, created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z',
    use_case_id: null, responsibility_id: null, unattended_mode: 'auto',
    ...extra,
  };
}

const chain = (id: string, target: string, source: string, extra: Partial<PersonaTrigger> = {}) =>
  trig(id, target, 'chain', { source_persona_id: source, condition: { type: 'any' }, event_type: 'chain_triggered' }, extra);

function sub(id: string, personaId: string, eventType: string, enabled = true): PersonaEventSubscription {
  return {
    id, persona_id: personaId, event_type: eventType, source_filter: null, enabled,
    created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z', use_case_id: null,
  };
}

function connectionsOf(triggers: PersonaTrigger[], subs: PersonaEventSubscription[] = []): Connection[] {
  return buildEventRows(triggers, [], subs, new Map()).flatMap((r) => r.connections);
}

function only(conns: Connection[], pred: (c: Connection) => boolean): Connection {
  const hits = conns.filter(pred);
  expect(hits).toHaveLength(1);
  return hits[0]!;
}

describe('cableVitals', () => {
  it('case 1: a disabled chain is paused, and the summary does not count it live', () => {
    const triggers = [chain('T1', 'B', 'A', { enabled: false, status: 'disabled' }), chain('T2', 'C', 'A')];
    const byId = indexById(triggers, []);
    const conns = connectionsOf(triggers);
    const paused = only(conns, (c) => c.triggerId === 'T1');
    const live = only(conns, (c) => c.triggerId === 'T2');

    expect(cableVitals(paused, byId).state).toBe('paused');
    expect(cableVitals(live, byId).state).toBe('live');
    expect(summarizeCables([paused, live].map((c) => cableVitals(c, byId)))).toEqual({ live: 1, paused: 1 });
  });

  it('case 1b: a trigger the runtime will not arm (status not active) is not live even when enabled', () => {
    // get_enabled_by_type / get_chain_triggers_for_source key on status = 'active'.
    const triggers = [chain('T1', 'B', 'A', { status: 'errored' })];
    const conn = only(connectionsOf(triggers), (c) => c.triggerId === 'T1');
    expect(cableVitals(conn, indexById(triggers, [])).state).toBe('paused');
  });

  it('case 2: the pulse is last_triggered_at of the chain, and null stays null', () => {
    const triggers = [chain('T1', 'B', 'A', { last_triggered_at: '2026-09-22T10:00:00Z' }), chain('T2', 'C', 'A')];
    const byId = indexById(triggers, []);
    const conns = connectionsOf(triggers);
    const fired = cableVitals(only(conns, (c) => c.triggerId === 'T1'), byId);
    const never = cableVitals(only(conns, (c) => c.triggerId === 'T2'), byId);

    expect(fired).toMatchObject({ lastFiredAt: '2026-09-22T10:00:00Z', firesTracked: true });
    expect(never).toMatchObject({ lastFiredAt: null, firesTracked: true });
  });

  it('case 2b: a route kind whose fires the backend never records claims no pulse at all', () => {
    // Only chain / schedule / polling / webhook write last_triggered_at; a listener
    // or a legacy subscription saying "never fired" would be a fabricated claim.
    const triggers = [trig('L1', 'B', 'event_listener', { listen_event_type: 'shared:ci' })];
    const subs = [sub('S1', 'B', 'webhook_received')];
    const byId = indexById(triggers, subs);
    const conns = connectionsOf(triggers, subs);
    expect(cableVitals(only(conns, (c) => c.triggerId === 'L1'), byId).firesTracked).toBe(false);
    expect(cableVitals(only(conns, (c) => c.subscriptionId === 'S1'), byId).firesTracked).toBe(false);
  });

  it('case 3: pausing a chain flips enabled on the chain trigger, owned by its target persona', () => {
    const conn = only(connectionsOf([chain('T', 'B', 'A')]), (c) => c.kind === 'chain');
    expect(pausePlan(conn)).toEqual({ api: 'updateTrigger', id: 'T', personaId: 'B', input: { enabled: false } });
  });

  it('case 4: pausing a subscription flips only enabled', () => {
    const subs = [sub('S', 'B', 'webhook_received')];
    const conn = only(connectionsOf([], subs), (c) => c.kind === 'subscription');
    expect(pausePlan(conn)).toEqual({
      api: 'updateSubscription', id: 'S', input: { event_type: null, source_filter: null, enabled: false },
    });
  });

  it('case 5: a signal route with its auto-listener is governed by the SOURCE trigger, not the listener', () => {
    const triggers = [
      trig('SRC', 'B', 'schedule', { cron: '0 3 * * 1' }, { last_triggered_at: '2026-09-21T03:00:00Z', enabled: false, status: 'disabled' }),
      trig('LSN', 'B', 'event_listener',
        { listen_event_type: 'trigger_fired', source_filter: 'SRC', _auto_for_trigger: 'SRC' },
        { last_triggered_at: null }),
    ];
    const conn = only(connectionsOf(triggers), (c) => c.route?.triggerIds.includes('LSN') ?? false);
    const vitals = cableVitals(conn, indexById(triggers, []));

    expect(vitals).toMatchObject({ state: 'paused', lastFiredAt: '2026-09-21T03:00:00Z', firesTracked: true });
    expect(pausePlan(conn)).toMatchObject({ api: 'updateTrigger', id: 'SRC', personaId: 'B' });
    expect(resumePlan(conn)).toEqual({
      dryRunId: 'SRC',
      call: { api: 'updateTrigger', id: 'SRC', personaId: 'B', input: { enabled: true } },
    });
  });

  it('case 6a: resuming a trigger-backed route is gated by a dry-run of that trigger; a subscription has none', () => {
    const subs = [sub('S', 'B', 'webhook_received', false)];
    const conns = connectionsOf([chain('T', 'B', 'A', { enabled: false, status: 'disabled' })], subs);
    expect(resumePlan(only(conns, (c) => c.kind === 'chain'))).toEqual({
      dryRunId: 'T', call: { api: 'updateTrigger', id: 'T', personaId: 'B', input: { enabled: true } },
    });
    expect(resumePlan(only(conns, (c) => c.kind === 'subscription'))).toEqual({
      dryRunId: null,
      call: { api: 'updateSubscription', id: 'S', input: { event_type: null, source_filter: null, enabled: true } },
    });
  });
});
