import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// System Check re-runs a section when something changed what it reports: a
// sign-in (account, cloud), a saved key (agents), a finished install
// (environment). A re-run asked for while that section's first check was
// still in flight was dropped, so the answer on screen came from the check
// that started BEFORE the change.

type Pending = { resolve: (v: unknown) => void };
const calls: Record<string, Pending[]> = {};
function fetcher(id: string) {
  return () => new Promise((resolve) => { (calls[id] ??= []).push({ resolve }); });
}
vi.mock('@/api/system/system', () => ({
  healthCheckLocal: fetcher('local'),
  healthCheckEnvironment: fetcher('environment'),
  healthCheckAgents: fetcher('agents'),
  healthCheckCloud: fetcher('cloud'),
  healthCheckAccount: fetcher('account'),
  healthCheckSubscriptions: fetcher('subscriptions'),
}));

import { useHealthSections } from '../useHealthSections';

const item = (detail: string) => ({ id: 'auth', label: 'Account', status: 'ok', detail, installable: false });

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
});

describe('useHealthSections', () => {
  it('a re-run asked for mid-flight runs, and its reply wins', async () => {
    const { result } = renderHook(() => useHealthSections());
    expect(calls.account).toHaveLength(1);

    act(() => { result.current.runSection('account'); }); // e.g. the user just signed in
    expect(calls.account).toHaveLength(2);

    await act(async () => { calls.account![1]!.resolve({ items: [item('signed in')] }); });
    await act(async () => { calls.account![0]!.resolve({ items: [item('signed out')] }); });

    const account = result.current.sections.find((s) => s.id === 'account')!;
    expect(account.items.map((i) => i.detail)).toEqual(['signed in']);
    expect(account.loading).toBe(false);
  });
});
