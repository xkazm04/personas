// canvasActionStore — the queue mechanics, refusal paths, and the pure band /
// payload math the Soundings consumer builds on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PICKUP_TIMEOUT_MS,
  __resetCanvasActionsForTests,
  canvasActionVersion,
  dimReadPayload,
  dispatchCanvasAction,
  islandReadPayload,
  subscribeCanvasActions,
  takeCanvasActions,
} from '../lib/canvasActionStore';
import type { Island } from '../lib/types';

const island = (over: Partial<Island> = {}): Island => ({
  slug: 'proj-a',
  name: 'Project A',
  purpose: 'testing',
  state: 'healthy',
  autoScore: 3,
  prodScore: 4,
  lifecycle: 'live',
  automationLabel: 'auto',
  blockers: 1,
  nodes: [
    { key: 'monitoring' as Island['nodes'][number]['key'], label: 'Monitoring', status: 'risk', detail: 'Sentry: 3 open', reached: 1, steps: 3, action: 'standards', rowKey: 'monitoring' },
  ],
  fleet: [{ id: 'f1', label: 'dev', state: 'running' }],
  personasRunning: ['Dev Clone'],
  attention: true,
  monitorErrors: 3,
  stateSource: 'errors',
  stats: [],
  ship: { next: 'MVP', nextStatus: 'active' as const, shipped: 1, total: 4, targetDate: null, forecastDate: null, late: false },
  ...over,
});

beforeEach(() => {
  vi.useFakeTimers();
  __resetCanvasActionsForTests();
});
afterEach(() => {
  __resetCanvasActionsForTests();
  vi.useRealTimers();
});

describe('queue mechanics', () => {
  it('dispatch resolves with the taker-settled result', async () => {
    const promise = dispatchCanvasAction({ kind: 'camera.read' });
    const taken = takeCanvasActions();
    expect(taken).toHaveLength(1);
    expect(taken[0]!.action).toEqual({ kind: 'camera.read' });
    taken[0]!.settle({ seq: taken[0]!.seq, ok: true });
    await expect(promise).resolves.toMatchObject({ ok: true });
  });

  it('take drains the queue — a second take gets nothing', () => {
    void dispatchCanvasAction({ kind: 'camera.read' });
    expect(takeCanvasActions()).toHaveLength(1);
    expect(takeCanvasActions()).toHaveLength(0);
  });

  it('an untaken action fails canvas_closed after the pickup timeout', async () => {
    const promise = dispatchCanvasAction({ kind: 'camera.read' });
    vi.advanceTimersByTime(PICKUP_TIMEOUT_MS + 1);
    await expect(promise).resolves.toMatchObject({ ok: false, reason: 'canvas_closed' });
    // ...and it is no longer in the queue for a late taker to double-settle.
    expect(takeCanvasActions()).toHaveLength(0);
  });

  it('a TAKEN action outlives the pickup timeout — the taker owns settling', async () => {
    const promise = dispatchCanvasAction({ kind: 'camera.read' });
    const [entry] = takeCanvasActions();
    vi.advanceTimersByTime(PICKUP_TIMEOUT_MS * 3);
    entry!.settle({ seq: entry!.seq, ok: true });
    await expect(promise).resolves.toMatchObject({ ok: true });
  });

  it('settle is idempotent — the first answer wins', async () => {
    const promise = dispatchCanvasAction({ kind: 'camera.read' });
    const [entry] = takeCanvasActions();
    entry!.settle({ seq: entry!.seq, ok: true });
    entry!.settle({ seq: entry!.seq, ok: false, reason: 'bad_request' });
    await expect(promise).resolves.toMatchObject({ ok: true });
  });

  it('dispatch bumps the version and notifies subscribers', () => {
    const before = canvasActionVersion();
    const listener = vi.fn();
    const unsubscribe = subscribeCanvasActions(listener);
    void dispatchCanvasAction({ kind: 'camera.read' });
    expect(canvasActionVersion()).toBeGreaterThan(before);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    takeCanvasActions().forEach((e) => e.settle({ seq: e.seq, ok: true }));
  });

  it('actions keep dispatch order in the queue', () => {
    void dispatchCanvasAction({ kind: 'camera.read' });
    void dispatchCanvasAction({ kind: 'camera.pan', dx: 10, dy: 0 });
    const taken = takeCanvasActions();
    expect(taken.map((e) => e.action.kind)).toEqual(['camera.read', 'camera.pan']);
    taken.forEach((e) => e.settle({ seq: e.seq, ok: true }));
  });
});

describe('payload builders', () => {
  it('islandReadPayload carries the full digest the narration needs', () => {
    const p = islandReadPayload(island());
    expect(p).toMatchObject({
      slug: 'proj-a',
      state: 'healthy',
      stateSource: 'errors',
      blockers: 1,
      attention: true,
      monitorErrors: 3,
      personasRunning: ['Dev Clone'],
      ship: { next: 'MVP', nextStatus: 'active' as const, shipped: 1, total: 4, targetDate: null, forecastDate: null, late: false },
    });
    expect(p.fleet).toEqual([{ id: 'f1', label: 'dev', state: 'running' }]);
    expect(p.dims).toHaveLength(1);
  });

  it('dimReadPayload reports the cell plus its Improve affordance', () => {
    const p = dimReadPayload(island().nodes[0]!);
    expect(p).toEqual({
      key: 'monitoring',
      label: 'Monitoring',
      status: 'risk',
      detail: 'Sentry: 3 open',
      reached: 1,
      steps: 3,
      action: 'standards',
    });
  });

  it('dimReadPayload reports inert cells as action null', () => {
    const node = { ...island().nodes[0]!, action: undefined };
    expect(dimReadPayload(node).action).toBeNull();
  });
});
