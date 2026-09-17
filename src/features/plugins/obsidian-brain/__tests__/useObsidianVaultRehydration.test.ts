import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getConfig = vi.fn();
vi.mock('@/api/obsidianBrain', () => ({
  obsidianBrainGetConfig: () => getConfig(),
}));
vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => () => {} }));

const CONFIG = { vaultPath: 'C:/vaults/personas', vaultName: 'personas' };

// The hook keeps a module-level one-shot flag, so every test loads a fresh copy.
async function load() {
  vi.resetModules();
  const { useSystemStore } = await import('@/stores/systemStore');
  useSystemStore.setState({ obsidianVaultPath: null, obsidianVaultName: null, obsidianConnected: false });
  const { useObsidianVaultRehydration } = await import('../useObsidianVaultRehydration');
  return { useSystemStore, useObsidianVaultRehydration };
}

describe('useObsidianVaultRehydration', () => {
  beforeEach(() => {
    getConfig.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('restores the persisted vault without any sign-in', async () => {
    getConfig.mockResolvedValue(CONFIG);
    const { useSystemStore, useObsidianVaultRehydration } = await load();
    const { useAuthStore } = await import('@/stores/authStore');
    expect(useAuthStore.getState().isAuthenticated).toBe(false);

    renderHook(() => useObsidianVaultRehydration());
    await vi.runAllTimersAsync();

    const s = useSystemStore.getState();
    expect(s.obsidianVaultPath).toBe(CONFIG.vaultPath);
    expect(s.obsidianVaultName).toBe(CONFIG.vaultName);
    expect(s.obsidianConnected).toBe(true);
  });

  it('retries when the first config read fails', async () => {
    getConfig.mockRejectedValueOnce(new Error('backend booting')).mockResolvedValue(CONFIG);
    const { useSystemStore, useObsidianVaultRehydration } = await load();

    renderHook(() => useObsidianVaultRehydration());
    await vi.runAllTimersAsync();

    expect(getConfig).toHaveBeenCalledTimes(2);
    expect(useSystemStore.getState().obsidianConnected).toBe(true);
  });

  it('does not clobber a vault activated earlier in the session', async () => {
    getConfig.mockResolvedValue(CONFIG);
    const { useSystemStore, useObsidianVaultRehydration } = await load();
    useSystemStore.setState({ obsidianVaultPath: 'C:/vaults/other', obsidianConnected: true });

    renderHook(() => useObsidianVaultRehydration());
    await vi.runAllTimersAsync();

    expect(useSystemStore.getState().obsidianVaultPath).toBe('C:/vaults/other');
  });
});
