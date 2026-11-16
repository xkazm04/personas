import { describe, it, expect, vi, beforeEach } from 'vitest';

const wrappers = vi.hoisted(() => ({
  getAuthState: vi.fn(),
  loginWithGoogle: vi.fn(),
  logoutUser: vi.fn(),
  clearPendingOauth: vi.fn(),
}));
vi.mock('@/api/auth/auth', () => wrappers);
// Any raw IPC from the store would reach this and fail the test.
const rawInvoke = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tauriInvoke', () => ({ invokeWithTimeout: rawInvoke }));
vi.mock('@/lib/utils/platform/crypto', () => ({ clearCryptoCache: () => undefined }));

import { useAuthStore, clearLoginTimeout } from '@/stores/authStore';

// The auth commands have one IPC door (src/api/auth/auth.ts): a timeout or arg
// change there must reach the store, so the store may not invoke them inline.
describe('authStore routes every auth command through the src/api/auth wrappers', () => {
  beforeEach(() => {
    Object.values(wrappers).forEach((f) => f.mockReset());
    rawInvoke.mockReset();
    wrappers.clearPendingOauth.mockResolvedValue(undefined);
    useAuthStore.setState({ isLoading: false, isAuthenticated: false, user: null, error: null });
  });

  it('initialize -> getAuthState', async () => {
    wrappers.getAuthState.mockResolvedValue({
      user: null, is_authenticated: true, is_offline: false, is_offline_authenticated: false,
    });
    await useAuthStore.getState().initialize();
    expect(wrappers.getAuthState).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
    expect(rawInvoke).not.toHaveBeenCalled();
  });

  it('loginWithGoogle -> loginWithGoogle, and a failure -> clearPendingOauth', async () => {
    wrappers.loginWithGoogle.mockRejectedValue({ error: 'no', kind: 'auth' });
    await useAuthStore.getState().loginWithGoogle();
    clearLoginTimeout();
    expect(wrappers.loginWithGoogle).toHaveBeenCalledOnce();
    expect(wrappers.clearPendingOauth).toHaveBeenCalledOnce();
    expect(rawInvoke).not.toHaveBeenCalled();
  });

  it('logout -> logoutUser', async () => {
    wrappers.logoutUser.mockResolvedValue(undefined);
    useAuthStore.setState({ isAuthenticated: true });
    await useAuthStore.getState().logout();
    expect(wrappers.logoutUser).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(rawInvoke).not.toHaveBeenCalled();
  });
});
