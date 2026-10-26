// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RemoteCommand } from '@/lib/bindings/RemoteCommand';

const invoke = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...args: unknown[]) => invoke(...args),
}));
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  toastCatch: () => () => undefined,
  silentCatch: () => () => undefined,
}));

import { useRemoteCommandStore } from '@/stores/remoteCommandStore';

// INVARIANT for the cast: only `id` is read by the store; the rest of the
// binding is irrelevant to queue bookkeeping.
const cmd = (id: string) => ({ id }) as RemoteCommand;
const stale = { error: 'This request is no longer pending', kind: 'validation' };

describe('remoteCommandStore: a request that stopped being pending leaves the queue', () => {
  beforeEach(() => {
    invoke.mockReset();
    useRemoteCommandStore.setState({ queue: [cmd('a'), cmd('b')], busyId: null });
  });

  it.each(['approve', 'reject'] as const)('%s failure + server no longer lists it -> dropped', async (verb) => {
    invoke.mockImplementation(async (name: string) => {
      if (name === 'remote_command_list_pending') return [cmd('b')];
      throw stale;
    });
    await useRemoteCommandStore.getState()[verb]('a');
    expect(useRemoteCommandStore.getState().queue.map((c) => c.id)).toEqual(['b']);
    expect(useRemoteCommandStore.getState().busyId).toBeNull();
  });

  it('failure while the server still lists it as pending -> kept', async () => {
    invoke.mockImplementation(async (name: string) => {
      if (name === 'remote_command_list_pending') return [cmd('a'), cmd('b')];
      throw { error: 'network down', kind: 'network_offline' };
    });
    await useRemoteCommandStore.getState().approve('a');
    expect(useRemoteCommandStore.getState().queue.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('failure and the re-list fails too -> kept (no evidence)', async () => {
    invoke.mockRejectedValue(stale);
    await useRemoteCommandStore.getState().reject('a');
    expect(useRemoteCommandStore.getState().queue.map((c) => c.id)).toEqual(['a', 'b']);
  });
});
