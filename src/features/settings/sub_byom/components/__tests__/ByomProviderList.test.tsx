/**
 * ByomProviderList - the provider connection test.
 *
 * invokeWithTimeout rejects with a serialized AppError OBJECT, never an Error.
 * The failure line must carry the backend's reason, not "[object Object]" and
 * not a generic "IPC call failed" that hides why the probe was refused.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ByomPolicy } from '@/api/system/byom';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const api = vi.hoisted(() => ({ testProviderConnection: vi.fn() }));

vi.mock('@/api/system/byom', () => api);
vi.mock('@/api/system/qwen', () => ({
  getQwenStatus: vi.fn().mockResolvedValue({ configured: false }),
}));

import { ByomProviderList } from '../ByomProviderList';

const policy: ByomPolicy = {
  enabled: true,
  allowed_providers: ['claude_code'],
  blocked_providers: [],
  routing_rules: [],
  compliance_rules: [],
};

describe('ByomProviderList connection test', () => {
  beforeEach(() => {
    api.testProviderConnection.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the backend reason when the IPC call rejects with an AppError object', async () => {
    api.testProviderConnection.mockRejectedValue({ error: 'Session expired, sign in again', kind: 'Auth' });
    render(
      <ByomProviderList policy={policy} usageStats={[]} usageTimeseries={[]} toggleProvider={() => {}} />,
    );
    await waitFor(() => expect(screen.getByText('Session expired, sign in again')).toBeInTheDocument());
    expect(screen.queryByText('IPC call failed')).not.toBeInTheDocument();
  });

  it('clears the 5 s race timer once the probe answers', async () => {
    const raceHandles: unknown[] = [];
    const realSetTimeout = globalThis.setTimeout;
    const setSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      const h = realSetTimeout(fn, ms);
      if (ms === 5000) raceHandles.push(h);
      return h;
    }) as typeof setTimeout);
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    api.testProviderConnection.mockResolvedValue({
      provider_id: 'claude_code',
      reachable: true,
      latency_ms: 3,
      version: '2.1.0',
      error: null,
    });
    render(
      <ByomProviderList policy={{ ...policy }} usageStats={[]} usageTimeseries={[]} toggleProvider={() => {}} />,
    );
    // The module-level health cache may already hold a fresh result from the
    // first case; force a manual test so the race actually runs.
    const button = await screen.findByRole('button', { name: /test connection/i });
    clearSpy.mockClear();
    raceHandles.length = 0;
    button.click();
    await waitFor(() => expect(screen.getByText('2.1.0')).toBeInTheDocument());
    expect(raceHandles).toHaveLength(1);
    expect(clearSpy).toHaveBeenCalledWith(raceHandles[0]);
    clearSpy.mockRestore();
    setSpy.mockRestore();
  });
});
