// The sweeper subscription is process-lifetime and attached once, from a mount
// effect that does not run again. A rejected listen used to latch that once,
// so a note finishing while the pad was shut never refetched.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import * as eventRegistry from '@/lib/eventRegistry';

import {
  SWEEP_LISTEN_RETRY_LIMIT,
  SWEEP_LISTEN_RETRY_MS,
  __resetNotepadStoreForTests,
  startNotepadListeners,
} from '../notepadStore';

let typedListen: MockInstance<typeof eventRegistry.typedListen>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  typedListen = vi.spyOn(eventRegistry, 'typedListen');
  __resetNotepadStoreForTests();
});

afterEach(() => {
  __resetNotepadStoreForTests();
  typedListen.mockRestore();
  vi.useRealTimers();
});

describe('notepad sweep listener', () => {
  it('subscribes again after the first listen rejects, without a second unload hook', async () => {
    typedListen.mockRejectedValueOnce(new Error('listen failed')).mockResolvedValueOnce(() => undefined);
    const added = vi.spyOn(window, 'addEventListener');

    startNotepadListeners();
    await Promise.resolve();
    expect(typedListen).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(SWEEP_LISTEN_RETRY_MS);
    expect(typedListen).toHaveBeenCalledTimes(2);
    expect(added.mock.calls.filter((call) => call[0] === 'beforeunload')).toHaveLength(1);
    expect(added.mock.calls.filter((call) => call[0] === 'pagehide')).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(SWEEP_LISTEN_RETRY_MS * SWEEP_LISTEN_RETRY_LIMIT);
    expect(typedListen).toHaveBeenCalledTimes(2);
    added.mockRestore();
  });

  it('drops a pending retry when the store resets', async () => {
    typedListen.mockRejectedValue(new Error('listen failed'));
    startNotepadListeners();
    await Promise.resolve();
    expect(typedListen).toHaveBeenCalledTimes(1);

    __resetNotepadStoreForTests();
    await vi.advanceTimersByTimeAsync(SWEEP_LISTEN_RETRY_MS * SWEEP_LISTEN_RETRY_LIMIT);
    expect(typedListen).toHaveBeenCalledTimes(1);
  });

  it('stops retrying once the cap is spent', async () => {
    typedListen.mockRejectedValue(new Error('listen failed'));
    startNotepadListeners();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(SWEEP_LISTEN_RETRY_MS * SWEEP_LISTEN_RETRY_LIMIT);
    expect(typedListen).toHaveBeenCalledTimes(SWEEP_LISTEN_RETRY_LIMIT);

    await vi.advanceTimersByTimeAsync(SWEEP_LISTEN_RETRY_MS * SWEEP_LISTEN_RETRY_LIMIT);
    expect(typedListen).toHaveBeenCalledTimes(SWEEP_LISTEN_RETRY_LIMIT);
  });
});
