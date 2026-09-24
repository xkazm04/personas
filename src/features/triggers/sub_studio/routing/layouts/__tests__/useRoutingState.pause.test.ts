/**
 * Pause and resume on a live cable: pause deletes nothing, resume walks the
 * same dry-run gate a new chain commit walks (useStudioComposer.commitLink).
 *
 * A paused route is a row with enabled = false, so the hourly
 * backfill_auto_listeners sweep (it recreates only MISSING listeners) and the
 * runtime (`status = 'active'` predicates in scheduling.rs) both leave it
 * alone, and turning it back on is one flip. The danger is the other
 * direction: a route whose source persona was deleted while it sat paused must
 * not silently come back broken, so resume dry-runs the governing trigger
 * first and stays paused when a check fails.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { PersonaEventSubscription } from '@/lib/bindings/PersonaEventSubscription';

const listAllTriggers = vi.fn();
const deleteTrigger = vi.fn();
const unlinkPersonaFromEvent = vi.fn();
const updateTrigger = vi.fn();
const dryRunTrigger = vi.fn();
const listAllSubscriptions = vi.fn();
const updateSubscription = vi.fn();
const deleteSubscription = vi.fn();
const addToast = vi.fn();

vi.mock('@/api/pipeline/triggers', () => ({
  listAllTriggers: (...a: unknown[]) => listAllTriggers(...a),
  deleteTrigger: (...a: unknown[]) => deleteTrigger(...a),
  unlinkPersonaFromEvent: (...a: unknown[]) => unlinkPersonaFromEvent(...a),
  updateTrigger: (...a: unknown[]) => updateTrigger(...a),
  dryRunTrigger: (...a: unknown[]) => dryRunTrigger(...a),
  linkPersonaToEvent: vi.fn(),
  renameEventType: vi.fn(),
}));

vi.mock('@/api/overview/events', () => ({
  listEvents: () => Promise.resolve([]),
  listAllSubscriptions: (...a: unknown[]) => listAllSubscriptions(...a),
  updateSubscription: (...a: unknown[]) => updateSubscription(...a),
  deleteSubscription: (...a: unknown[]) => deleteSubscription(...a),
}));

vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector({ addToast }),
    { getState: () => ({ addToast }) },
  ),
}));

import { useRoutingState } from '../useRoutingState';
import type { Connection } from '../routingHelpers';

function trig(id: string, personaId: string, triggerType: string, config: Record<string, unknown>, extra: Partial<PersonaTrigger> = {}): PersonaTrigger {
  return {
    id, persona_id: personaId, trigger_type: triggerType, config: JSON.stringify(config),
    enabled: true, status: 'active', last_triggered_at: null, next_trigger_at: null,
    trigger_version: 0, created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z',
    use_case_id: null, responsibility_id: null, unattended_mode: 'auto',
    ...extra,
  };
}

const SUB: PersonaEventSubscription = {
  id: 'SUB', persona_id: 'D', event_type: 'webhook_received', source_filter: null, enabled: true,
  created_at: '2026-09-23T00:00:00Z', updated_at: '2026-09-23T00:00:00Z', use_case_id: null,
};

const TRIGGERS = [
  trig('CH', 'B', 'chain', { source_persona_id: 'A', condition: { type: 'any' }, event_type: 'chain_triggered' }),
  trig('PAUSED', 'C', 'chain', { source_persona_id: 'A', condition: { type: 'success' }, event_type: 'chain_triggered' },
    { enabled: false, status: 'disabled' }),
  trig('SRC', 'B', 'schedule', { cron: '0 3 * * 1' }),
  trig('LSN', 'B', 'event_listener', { listen_event_type: 'trigger_fired', source_filter: 'SRC', _auto_for_trigger: 'SRC' }),
  trig('FEED', 'E', 'event_listener', { listen_event_type: 'shared:ci' }),
];

const passing = { valid: true, validation: { checks: [] }, simulated_event: null, matched_subscriptions: [] };
const failing = {
  valid: false,
  validation: { checks: [{ passed: true, message: 'target exists' }, { passed: false, message: 'source persona not found' }] },
  simulated_event: null, matched_subscriptions: [],
};

beforeEach(() => {
  for (const f of [deleteTrigger, unlinkPersonaFromEvent, updateTrigger, dryRunTrigger, updateSubscription, deleteSubscription, addToast]) f.mockReset();
  listAllTriggers.mockReset().mockResolvedValue(TRIGGERS);
  listAllSubscriptions.mockReset().mockResolvedValue([SUB]);
  updateTrigger.mockResolvedValue(undefined);
  updateSubscription.mockResolvedValue(undefined);
  deleteTrigger.mockResolvedValue(true);
  deleteSubscription.mockResolvedValue(true);
  unlinkPersonaFromEvent.mockResolvedValue(true);
  dryRunTrigger.mockResolvedValue(passing);
});

async function mounted() {
  const hook = renderHook(() => useRoutingState({ personas: [], teams: [] }));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

const conns = (h: Awaited<ReturnType<typeof mounted>>) => h.result.current.rows.flatMap((r) => r.connections);
const pick = (all: Connection[], pred: (c: Connection) => boolean): Connection => {
  const hit = all.find(pred);
  expect(hit).toBeDefined();
  return hit!;
};

function expectNothingDeleted() {
  expect(deleteTrigger).not.toHaveBeenCalled();
  expect(deleteSubscription).not.toHaveBeenCalled();
  expect(unlinkPersonaFromEvent).not.toHaveBeenCalled();
}

describe('useRoutingState pause / resume', () => {
  it('pause flips enabled off on the governing row of every connection kind and deletes nothing', async () => {
    const h = await mounted();
    const all = conns(h);
    for (const c of [
      pick(all, (x) => x.triggerId === 'CH'),
      pick(all, (x) => x.triggerId === 'SRC'),
      pick(all, (x) => x.triggerId === 'FEED'),
      pick(all, (x) => x.subscriptionId === 'SUB'),
    ]) {
      await act(async () => { await h.result.current.handleSetPaused(c, true); });
    }
    expect(updateTrigger.mock.calls).toEqual([
      ['CH', 'B', { enabled: false }],
      ['SRC', 'B', { enabled: false }],
      ['FEED', 'E', { enabled: false }],
    ]);
    expect(updateSubscription).toHaveBeenCalledWith('SUB', { event_type: null, source_filter: null, enabled: false });
    expect(dryRunTrigger).not.toHaveBeenCalled();
    expectNothingDeleted();
  });

  it('exposes the vitals: a paused route is not counted live', async () => {
    const h = await mounted();
    const paused = pick(conns(h), (x) => x.triggerId === 'PAUSED');
    expect(h.result.current.vitalsOf(paused).state).toBe('paused');
    expect(h.result.current.cableSummary).toEqual({ live: 4, paused: 1 });
  });

  it('case 6: resume dry-runs first and enables only when the dry-run is valid', async () => {
    const h = await mounted();
    const paused = pick(conns(h), (x) => x.triggerId === 'PAUSED');
    await act(async () => { await h.result.current.handleSetPaused(paused, false); });

    expect(dryRunTrigger).toHaveBeenCalledWith('PAUSED');
    expect(updateTrigger).toHaveBeenCalledWith('PAUSED', 'C', { enabled: true });
    expect(dryRunTrigger.mock.invocationCallOrder[0]!).toBeLessThan(updateTrigger.mock.invocationCallOrder[0]!);
    expectNothingDeleted();
  });

  it('case 6: a failed dry-run leaves the route paused and toasts the failed check', async () => {
    dryRunTrigger.mockResolvedValue(failing);
    const h = await mounted();
    const paused = pick(conns(h), (x) => x.triggerId === 'PAUSED');
    await act(async () => { await h.result.current.handleSetPaused(paused, false); });

    expect(updateTrigger).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledTimes(1);
    const [message, kind] = addToast.mock.calls[0]!;
    expect(kind).toBe('error');
    expect(String(message)).toContain('source persona not found');
    expectNothingDeleted();
  });

  it('[guard] disconnect on every connection kind still routes through handleDisconnect unchanged', async () => {
    const h = await mounted();
    const all = conns(h);
    const cases: Array<[Connection, () => void]> = [
      [pick(all, (x) => x.triggerId === 'CH'), () => expect(deleteTrigger).toHaveBeenLastCalledWith('CH', 'B')],
      [pick(all, (x) => x.triggerId === 'SRC'), () => expect(deleteTrigger).toHaveBeenLastCalledWith('SRC', 'B')],
      [pick(all, (x) => x.triggerId === 'FEED'), () => expect(unlinkPersonaFromEvent).toHaveBeenLastCalledWith('FEED')],
      [pick(all, (x) => x.subscriptionId === 'SUB'), () => expect(deleteSubscription).toHaveBeenLastCalledWith('SUB')],
    ];
    for (const [connection, check] of cases) {
      act(() => h.result.current.setDisconnectTarget({ connection, personaName: 'x', eventLabel: 'y' }));
      await act(async () => { await h.result.current.handleDisconnect(); });
      check();
    }
    expect(updateTrigger).not.toHaveBeenCalled();
  });
});
