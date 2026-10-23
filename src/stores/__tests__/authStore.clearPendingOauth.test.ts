import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invoke = vi.fn();
vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: (...args: unknown[]) => invoke(...args),
}));
vi.mock('@/lib/utils/platform/crypto', () => ({ clearCryptoCache: () => undefined }));

import { useAuthStore, clearLoginTimeout } from '@/stores/authStore';

// `clear_pending_oauth` is fire-and-forget cleanup. When it rejects too (the
// backend that just failed the login is often the reason), the rejection must
// have a handler attached, or it escapes as an unhandled promise rejection.
// The test hands back a rejected promise and checks a handler was attached to
// THAT promise, which is the property, independent of how the runner reports
// unhandled rejections.
function rejectedCleanup() {
  const p = Promise.reject({ error: 'backend down', kind: 'internal' });
  void p.then(undefined, () => undefined); // keep the runner quiet; the assertion is on the spy
  // Spy on `catch` only: vi.fn() itself calls `then` on a returned promise to
  // track settled results, so a `then` spy would pass on the unfixed code.
  const handled = vi.spyOn(p, 'catch');
  return { p, attached: () => handled.mock.calls.length > 0 };
}

describe('authStore: clear_pending_oauth cleanup always has a rejection handler', () => {
  beforeEach(() => {
    invoke.mockReset();
    useAuthStore.setState({ isLoading: false, isAuthenticated: false, error: null });
  });
  afterEach(() => {
    clearLoginTimeout();
    vi.useRealTimers();
  });

  it('login failure path', async () => {
    const cleanup = rejectedCleanup();
    invoke.mockImplementation((cmd: string) =>
      cmd === 'clear_pending_oauth' ? cleanup.p : Promise.reject({ error: 'no', kind: 'auth' }));
    await useAuthStore.getState().loginWithGoogle();
    expect(invoke).toHaveBeenCalledWith('clear_pending_oauth');
    expect(cleanup.attached()).toBe(true);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });

  it('login timeout path', async () => {
    vi.useFakeTimers();
    const cleanup = rejectedCleanup();
    invoke.mockImplementation((cmd: string) =>
      cmd === 'clear_pending_oauth' ? cleanup.p : Promise.resolve(undefined));
    await useAuthStore.getState().loginWithGoogle();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(invoke).toHaveBeenCalledWith('clear_pending_oauth');
    expect(cleanup.attached()).toBe(true);
    expect(useAuthStore.getState().isLoading).toBe(false);
  });
});
