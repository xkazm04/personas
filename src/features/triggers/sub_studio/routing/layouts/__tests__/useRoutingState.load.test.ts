/**
 * A failed roster fetch is not an empty roster.
 *
 * `listAllTriggers` / `listAllSubscriptions` rejecting used to flip `loading`
 * off with zero rows, which the ledger renders as the "No routes yet" first-run
 * illustration - inviting the user to rebuild routes that exist. The hook now
 * exposes `loadError`, and a successful `reload` (the Retry) clears it.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const listAllTriggers = vi.fn();
const listAllSubscriptions = vi.fn();

vi.mock('@/api/pipeline/triggers', () => ({
  listAllTriggers: (...a: unknown[]) => listAllTriggers(...a),
  deleteTrigger: vi.fn(),
  unlinkPersonaFromEvent: vi.fn(),
  linkPersonaToEvent: vi.fn(),
  renameEventType: vi.fn(),
}));

vi.mock('@/api/overview/events', () => ({
  listEvents: () => Promise.resolve([]),
  listAllSubscriptions: (...a: unknown[]) => listAllSubscriptions(...a),
  deleteSubscription: vi.fn(),
}));

import { useRoutingState } from '../useRoutingState';

beforeEach(() => {
  listAllTriggers.mockReset().mockResolvedValue([]);
  listAllSubscriptions.mockReset().mockResolvedValue([]);
});

describe('useRoutingState load failure', () => {
  it('a clean empty roster is not an error', async () => {
    const { result } = renderHook(() => useRoutingState({ personas: [], teams: [] }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toBe(false);
  });

  it('a rejected trigger fetch sets loadError instead of passing as zero rows', async () => {
    listAllTriggers.mockRejectedValueOnce(new Error('ipc timeout'));
    const { result } = renderHook(() => useRoutingState({ personas: [], teams: [] }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toBe(true);
  });

  it('a rejected subscription fetch sets loadError, and a successful reload clears it', async () => {
    listAllSubscriptions.mockRejectedValueOnce(new Error('ipc timeout'));
    const { result } = renderHook(() => useRoutingState({ personas: [], teams: [] }));
    await waitFor(() => expect(result.current.loadError).toBe(true));

    await act(async () => { await result.current.reload(); });
    expect(result.current.loadError).toBe(false);
  });
});
