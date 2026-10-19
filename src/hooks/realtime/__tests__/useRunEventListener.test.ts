/**
 * `useRunEventListener` drives the Lab run lifecycle (useLabEvents): onProgress
 * paints progress, onTerminal clears the run's "running" state. Two silent
 * failure modes are pinned here:
 *  1. a throwing onProgress skipped onTerminal, leaving the run spinning;
 *  2. a binding whose listen() rejected was dropped by allSettled with no
 *     report, so a dead channel looked exactly like an idle one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { listen, type EventCallback } from '@tauri-apps/api/event';

const reportSpy = vi.fn();
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  silentCatch: (label: string) => (err: unknown) => reportSpy(label, err),
}));

import { useRunEventListener, type RunEventBinding } from '../useRunEventListener';

const listenMock = vi.mocked(listen);
const handlers = new Map<string, EventCallback<{ run_id: string; phase: string }>>();

async function flush() {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  });
}

describe('useRunEventListener', () => {
  beforeEach(() => {
    handlers.clear();
    reportSpy.mockReset();
    listenMock.mockReset();
    listenMock.mockImplementation(async (name: string, cb: unknown) => {
      handlers.set(name, cb as EventCallback<{ run_id: string; phase: string }>);
      return () => {};
    });
  });

  it('still fires onTerminal when onProgress throws', async () => {
    const onTerminal = vi.fn();
    const bindings: RunEventBinding[] = [{
      eventName: 'lab-arena-status',
      onProgress: () => {
        throw new Error('render bug');
      },
      onTerminal,
    }];
    const view = renderHook(() => useRunEventListener(bindings));
    await flush();

    handlers.get('lab-arena-status')!({
      event: 'lab-arena-status',
      id: 1,
      payload: { run_id: 'r1', phase: 'completed' },
    });

    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(reportSpy).toHaveBeenCalledWith(
      'hooks/realtime/useRunEventListener:lab-arena-status:onProgress',
      expect.any(Error),
    );
    view.unmount();
  });

  it('reports a binding whose listen() rejected and keeps its siblings', async () => {
    listenMock.mockImplementation(async (name: string, cb: unknown) => {
      if (name === 'lab-ab-status') throw { error: 'denied', kind: 'ipc' };
      handlers.set(name, cb as EventCallback<{ run_id: string; phase: string }>);
      return () => {};
    });
    const onProgress = vi.fn();
    const bindings: RunEventBinding[] = [
      { eventName: 'lab-ab-status', onProgress, onTerminal: vi.fn() },
      { eventName: 'lab-eval-status', onProgress, onTerminal: vi.fn() },
    ];
    const view = renderHook(() => useRunEventListener(bindings));
    await flush();

    expect(reportSpy).toHaveBeenCalledWith(
      'hooks/realtime/useRunEventListener:lab-ab-status:attach',
      { error: 'denied', kind: 'ipc' },
    );
    handlers.get('lab-eval-status')!({
      event: 'lab-eval-status',
      id: 2,
      payload: { run_id: 'r2', phase: 'running' },
    });
    expect(onProgress).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
