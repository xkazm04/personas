/**
 * A STREAM TORN DOWN WHILE IT IS STILL REGISTERING MUST NOT COME BACK.
 *
 * `start()` awaits two `listen()` round trips. A `cleanup()`, an unmount or a
 * second `start()` that lands inside that await found nothing to unlisten yet,
 * and the stale call then installed its listeners anyway: live for the rest of
 * the session after an unmount, or -- after a second start -- the previous
 * run's lines piped into the new run's view.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { listen } from '@tauri-apps/api/event';
import { useCorrelatedCliStream } from '../useCorrelatedCliStream';
import { flushCliStreamFrames } from '../cliStreamBuffer';

type Handler = (event: { payload: Record<string, unknown> }) => void;

/** Registrations that have resolved and not been unlistened. */
let live: { name: string; cb: Handler }[] = [];
/** Resolvers for registrations still in flight. */
let pending: (() => void)[] = [];

function resolveRegistrations() {
  const now = pending;
  pending = [];
  for (const r of now) r();
}

function emit(name: string, payload: Record<string, unknown>) {
  for (const l of [...live]) if (l.name === name) l.cb({ payload });
  flushCliStreamFrames();
}

beforeEach(() => {
  live = [];
  pending = [];
  vi.mocked(listen).mockImplementation(((name: string, cb: Handler) =>
    new Promise((resolve) => {
      pending.push(() => {
        const entry = { name, cb };
        live.push(entry);
        resolve(() => { live = live.filter((l) => l !== entry); });
      });
    })) as unknown as typeof listen);
});

const OPTS = { outputEvent: 'out', statusEvent: 'status', idField: 'run_id' } as const;

describe('useCorrelatedCliStream registration window', () => {
  it('an unmount during registration leaves no listener behind', async () => {
    const { result, unmount } = renderHook(() => useCorrelatedCliStream(OPTS));

    let started!: Promise<void>;
    act(() => { started = result.current.start('run-1'); });
    await act(async () => { await Promise.resolve(); });
    unmount();

    await act(async () => { resolveRegistrations(); await started; });
    expect(live).toHaveLength(0);
  });

  it('a second start during registration owns the stream alone', async () => {
    const { result } = renderHook(() => useCorrelatedCliStream(OPTS));

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => { first = result.current.start('run-A'); });
    await act(async () => { await Promise.resolve(); });
    act(() => { second = result.current.start('run-B'); });
    await act(async () => { await Promise.resolve(); });

    await act(async () => { resolveRegistrations(); await first; await second; });

    // Only run B's two listeners survive.
    expect(live).toHaveLength(2);
    act(() => {
      emit('out', { run_id: 'run-A', line: 'from A' });
      emit('out', { run_id: 'run-B', line: 'from B' });
    });
    expect(result.current.lines).toEqual(['from B']);
  });
});
