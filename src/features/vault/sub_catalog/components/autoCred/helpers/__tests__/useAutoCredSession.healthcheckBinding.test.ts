import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * A healthcheck verdict is a claim about the values it tested.
 *
 * Save is gated on `healthResult.success` and persists it as
 * `healthcheck_passed`, so a verdict that outlives an edit (or a re-run, or a
 * check still in flight when a value changes) lets untested values be saved
 * and recorded as tested.
 */

const createCredential = vi.fn(async (_input: unknown) => 'cred-1');
const fetchCredentials = vi.fn(async () => {});
const healthcheckCredentialPreview = vi.fn();

vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: (sel: (s: unknown) => unknown) =>
    sel({ createCredential, fetchCredentials, healthcheckCredentialPreview }),
}));

import { useAutoCredSession, clearAutoCredResumeCache, type AdapterResult } from '../useAutoCredSession';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';

const design = {
  connector: {
    name: 'acme',
    label: 'Acme',
    fields: [{ key: 'api_key', label: 'API Key', type: 'password', required: true }],
  },
} as unknown as CredentialDesignResult;

const adapter = { run: async (): Promise<AdapterResult> => ({ values: { api_key: 'tested-value' }, partial: false }) };

async function reviewSession() {
  const h = renderHook(() => useAutoCredSession({ adapter }));
  await act(async () => { h.result.current.init(design); });
  await act(async () => { await h.result.current.startBrowser(); });
  expect(h.result.current.phase).toBe('review');
  return h;
}

describe('useAutoCredSession: a healthcheck verdict binds to the values it tested', () => {
  beforeEach(() => {
    clearAutoCredResumeCache();
    createCredential.mockClear();
    healthcheckCredentialPreview.mockReset();
  });

  it('an edit after a passing check voids the verdict', async () => {
    healthcheckCredentialPreview.mockResolvedValue({ success: true, message: 'ok' });
    const h = await reviewSession();
    await act(async () => { await h.result.current.runHealthcheck(); });
    expect(h.result.current.healthResult?.success).toBe(true);

    act(() => { h.result.current.updateValue('api_key', 'edited-untested'); });
    expect(h.result.current.healthResult).toBeNull();

    await act(async () => { await h.result.current.save(); });
    expect(createCredential).toHaveBeenCalledWith(expect.objectContaining({ healthcheck_passed: false }));
  });

  it('a check in flight when a value changes does not land', async () => {
    let resolveCheck!: (v: { success: boolean; message: string }) => void;
    healthcheckCredentialPreview.mockReturnValue(new Promise((r) => { resolveCheck = r; }));
    const h = await reviewSession();

    let pending!: Promise<void>;
    act(() => { pending = h.result.current.runHealthcheck(); });
    act(() => { h.result.current.updateValue('api_key', 'edited-mid-check'); });
    await act(async () => { resolveCheck({ success: true, message: 'ok' }); await pending; });

    expect(h.result.current.healthResult).toBeNull();
  });

  it('re-running the browser voids the previous verdict', async () => {
    healthcheckCredentialPreview.mockResolvedValue({ success: true, message: 'ok' });
    const h = await reviewSession();
    await act(async () => { await h.result.current.runHealthcheck(); });
    expect(h.result.current.healthResult?.success).toBe(true);

    await act(async () => { await h.result.current.startBrowser(); });
    expect(h.result.current.healthResult).toBeNull();
  });
});
