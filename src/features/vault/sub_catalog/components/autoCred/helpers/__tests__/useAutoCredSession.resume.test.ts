import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Navigating away from the AutoCred wizard used to be an implicit discard.
 *
 * `init` always reset the phase to `consent` and cleared `extractedValues`, so
 * a ten-minute browser session that had already pulled two of three fields was
 * thrown away by a sidebar click, with no record that consent had ever been
 * given. Coming back re-asked for consent and re-ran the browser.
 */

const createCredential = vi.fn(async () => 'cred-1');
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
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', required: true },
      { key: 'team_id', label: 'Team', type: 'text', required: true },
      { key: 'region', label: 'Region', type: 'text', required: true },
    ],
  },
} as unknown as CredentialDesignResult;

/** An adapter that harvests two of the three fields, then reports partial. */
function partialAdapter(): { run: () => Promise<AdapterResult> } {
  return {
    run: async () => ({ values: { api_key: 'sk-live', team_id: 't-1' }, partial: true }),
  };
}

/** Drive one panel lifetime: mount, run the browser, unmount. */
async function harvestThenUnmount() {
  const h = renderHook(() => useAutoCredSession({ adapter: partialAdapter() }));
  await act(async () => { h.result.current.init(design); });
  await act(async () => { await h.result.current.startBrowser(); });
  const phase = h.result.current.phase;
  const values = h.result.current.extractedValues;
  h.unmount();
  return { phase, values };
}

describe('useAutoCredSession — an unmount is not a discard', () => {
  beforeEach(() => {
    clearAutoCredResumeCache();
    createCredential.mockClear();
    fetchCredentials.mockClear();
  });

  it('gives the harvested values back on remount, without re-asking for consent', async () => {
    const first = await harvestThenUnmount();
    expect(first.phase).toBe('review');
    expect(first.values).toMatchObject({ api_key: 'sk-live', team_id: 't-1' });

    // A fresh panel for the same connector, as a route remount produces.
    const second = renderHook(() => useAutoCredSession({ adapter: partialAdapter() }));
    await act(async () => { second.result.current.init(design); });

    expect(second.result.current.phase).toBe('review');
    expect(second.result.current.extractedValues).toMatchObject({ api_key: 'sk-live', team_id: 't-1' });
    expect(second.result.current.isPartial).toBe(true);
  });

  it('starts at consent for a connector with nothing in flight', async () => {
    const h = renderHook(() => useAutoCredSession({ adapter: partialAdapter() }));
    await act(async () => { h.result.current.init(design); });
    expect(h.result.current.phase).toBe('consent');
    expect(h.result.current.extractedValues).toEqual({});
  });

  it('does not resume a browser phase, so a remount cannot relaunch Chromium', async () => {
    // A slow adapter leaves the session in `browser` when the panel unmounts.
    const hanging = { run: () => new Promise<AdapterResult>(() => {}) };
    const h = renderHook(() => useAutoCredSession({ adapter: hanging }));
    await act(async () => { h.result.current.init(design); });
    act(() => { void h.result.current.startBrowser(); });
    expect(h.result.current.phase).toBe('browser');
    h.unmount();

    const second = renderHook(() => useAutoCredSession({ adapter: hanging }));
    await act(async () => { second.result.current.init(design); });
    // Back to consent: the panel's cleanup killed the browser, so there is no
    // live session to paint and nothing was harvested to hand back.
    expect(second.result.current.phase).toBe('consent');
  });

  it('forgets the harvest once it is in the vault', async () => {
    await harvestThenUnmount();
    const second = renderHook(() => useAutoCredSession({ adapter: partialAdapter() }));
    await act(async () => { second.result.current.init(design); });
    await act(async () => { await second.result.current.save(); });
    expect(createCredential).toHaveBeenCalledTimes(1);

    const third = renderHook(() => useAutoCredSession({ adapter: partialAdapter() }));
    await act(async () => { third.result.current.init(design); });
    expect(third.result.current.phase).toBe('consent');
    expect(third.result.current.extractedValues).toEqual({});
  });

  it('forgets the harvest when the user explicitly discards it', async () => {
    await harvestThenUnmount();
    const second = renderHook(() => useAutoCredSession({ adapter: partialAdapter() }));
    await act(async () => { second.result.current.init(design); });
    act(() => { second.result.current.reset(); });

    const third = renderHook(() => useAutoCredSession({ adapter: partialAdapter() }));
    await act(async () => { third.result.current.init(design); });
    expect(third.result.current.phase).toBe('consent');
    expect(third.result.current.extractedValues).toEqual({});
  });
});
