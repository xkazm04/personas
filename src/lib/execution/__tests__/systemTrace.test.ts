/**
 * A REGISTRY WITH ONE SUBSCRIBER SLOT IS A REGISTRY THAT LOSES SUBSCRIBERS.
 *
 * `_onSessionChange` was a single mutable slot that `onSystemTraceChange`
 * overwrote. `useSystemTraces()` is a `useSyncExternalStore` subscribe — it
 * assumes N independent subscribers — so a second mount silently stole every
 * update from the first, and its unsubscribe cleared the slot for everyone.
 *
 * The other half: `_completedTraces` was capped at 100 while `_activeSessions`
 * was uncapped and never aged. Callers that never complete their session (the
 * two design hooks, until this change) left a row that counts as "active" for
 * the life of the app session — a phantom badge on the Observability trace
 * panel that no action could clear.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SystemTraceSession,
  onSystemTraceChange,
  getActiveSessions,
  getAllSystemTraces,
  getCompletedTraces,
  clearCompletedTraces,
  __resetSystemTracesForTests,
} from '../systemTrace';

beforeEach(() => {
  __resetSystemTracesForTests();
});

afterEach(() => {
  vi.useRealTimers();
  __resetSystemTracesForTests();
});

describe('system trace registry — subscribers', () => {
  it('notifies every subscriber, not just the last one registered', () => {
    const first = vi.fn();
    const second = vi.fn();
    onSystemTraceChange(first);
    onSystemTraceChange(second);

    SystemTraceSession.start('design_conversation', 'Design Analysis');

    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it('unsubscribes only the caller\'s own listener', () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = onSystemTraceChange(first);
    onSystemTraceChange(second);

    offFirst();
    SystemTraceSession.start('design_conversation', 'Design Analysis');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
  });

  it('keeps notifying the others when one listener throws', () => {
    const survivor = vi.fn();
    onSystemTraceChange(() => {
      throw new Error('bad subscriber');
    });
    onSystemTraceChange(survivor);

    expect(() => SystemTraceSession.start('design_conversation', 'x')).not.toThrow();
    expect(survivor).toHaveBeenCalled();
  });
});

describe('system trace registry — abandoned sessions', () => {
  it('ages out a session with no span activity past the TTL', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const session = SystemTraceSession.start('design_conversation', 'Abandoned');
    expect(getActiveSessions()).toHaveLength(1);

    // Nine minutes of silence is still a live operation.
    vi.setSystemTime(new Date('2026-01-01T00:09:00Z'));
    expect(getActiveSessions()).toHaveLength(1);

    // Past the ten-minute TTL it is closed, kept as a trace, and marked
    // abandoned rather than errored -- nothing failed, nobody finished it.
    vi.setSystemTime(new Date('2026-01-01T00:11:00Z'));
    expect(getActiveSessions()).toHaveLength(0);
    expect(session.isComplete).toBe(true);

    const [trace] = getCompletedTraces();
    expect(trace?.abandoned).toBe(true);
    expect(trace?.spans.every((s) => s.error === null)).toBe(true);
  });

  it('keeps a session alive while its spans are still moving', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const session = SystemTraceSession.start('design_conversation', 'Busy');

    vi.setSystemTime(new Date('2026-01-01T00:09:00Z'));
    session.beginSpan('design_conversation', 'still working');

    vi.setSystemTime(new Date('2026-01-01T00:15:00Z'));
    expect(getActiveSessions()).toHaveLength(1);
  });

  it('caps active sessions, evicting the least recently active', () => {
    const kept: SystemTraceSession[] = [];
    for (let i = 0; i < 51; i++) {
      kept.push(SystemTraceSession.start('design_conversation', `run ${i}`));
    }

    expect(getActiveSessions()).toHaveLength(50);
    // The first-started session is the one with the oldest activity.
    expect(kept[0]?.isComplete).toBe(true);
    expect(kept[1]?.isComplete).toBe(false);
    expect(getCompletedTraces()[0]?.abandoned).toBe(true);
  });

  it('does not record a session twice when it is closed twice', () => {
    const session = SystemTraceSession.start('design_conversation', 'Once');
    session.complete();
    session.abandon();
    session.complete();

    expect(getCompletedTraces()).toHaveLength(1);
    expect(getCompletedTraces()[0]?.abandoned).toBeUndefined();
  });
});

describe('system trace registry — reset hatch', () => {
  it('clears active sessions and completed traces, keeping subscribers', () => {
    const listener = vi.fn();
    onSystemTraceChange(listener);

    SystemTraceSession.start('design_conversation', 'active');
    SystemTraceSession.start('design_conversation', 'done').complete();
    expect(getAllSystemTraces()).toHaveLength(2);

    __resetSystemTracesForTests();
    expect(getAllSystemTraces()).toHaveLength(0);
    expect(getActiveSessions()).toHaveLength(0);

    // The subscriber belongs to a mounted component, not to this module.
    listener.mockClear();
    clearCompletedTraces();
    expect(listener).toHaveBeenCalled();
  });
});
