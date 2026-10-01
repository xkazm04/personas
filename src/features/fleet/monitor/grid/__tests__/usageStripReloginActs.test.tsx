// The strip's re-login acts: a COMMAND failure is an ordinary error (it toasts and
// reaches Sentry); a run that merely ends "needs you" resolves and says nothing.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUsageActions } from '../usageStripActions';
import { useToastStore } from '@/stores/toastStore';
import type { ClaudeAccountsState } from '../useClaudeAccounts';
import { buildSimAccountsSnapshot } from '../simulation/simPlans';

const NOW = 1_800_000_000_000;

vi.mock('@/api/vault/credentials', () => ({
  listCredentials: vi.fn(() => Promise.resolve([{ id: 'c1', name: 'Mailbox', serviceType: 'x' }])),
}));

function state(over: Partial<ClaudeAccountsState> = {}): ClaudeAccountsState {
  return {
    snapshot: buildSimAccountsSnapshot(NOW),
    ipcFailed: false,
    fetchedAt: NOW,
    canRefresh: true,
    refresh: vi.fn(),
    capture: vi.fn(),
    switchTo: vi.fn(),
    remove: vi.fn(),
    setAutoRotate: vi.fn(),
    relogin: vi.fn(() => Promise.resolve()),
    openSignIn: vi.fn(() => Promise.resolve()),
    saveProfile: vi.fn(() => Promise.resolve()),
    setProfile: vi.fn(() => Promise.resolve()),
    ...over,
  } as ClaudeAccountsState;
}

describe('useUsageActions: re-login acts', () => {
  beforeEach(() => { useToastStore.setState({ toasts: [] }); });

  it('exposes the snapshot\'s profiles and the vault logins', async () => {
    const { result } = renderHook(() => useUsageActions(state()));
    expect(result.current.relogin.profiles.map((p) => p.key)).toEqual(['work-chrome', 'proton-inbox']);
    await expect(result.current.relogin.listVaultLogins()).resolves.toEqual([{ id: 'c1', name: 'Mailbox' }]);
  });

  it('a run that resolves (including one that ended needs-you) raises no toast', async () => {
    const accounts = state();
    const { result } = renderHook(() => useUsageActions(accounts));
    await result.current.relogin.relogin('sim-plan-5');
    expect(accounts.relogin).toHaveBeenCalledWith('sim-plan-5');
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('a rejected command (the backend refused) toasts the error and does not throw', async () => {
    const accounts = state({ relogin: vi.fn(() => Promise.reject(new Error('not available yet'))) });
    const { result } = renderHook(() => useUsageActions(accounts));
    await expect(result.current.relogin.relogin('sim-plan-5')).resolves.toBeUndefined();
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.type).toBe('error');
  });

  it('a failed settings write toasts AND rejects, so the dialog stays open', async () => {
    const accounts = state({ setProfile: vi.fn(() => Promise.reject(new Error('validation'))) });
    const { result } = renderHook(() => useUsageActions(accounts));
    await expect(result.current.relogin.setProfile('sim-plan-5', 'x', null, false)).rejects.toThrow('validation');
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });
});
