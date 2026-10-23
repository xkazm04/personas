import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

/**
 * A fetch shared by several cells must reach every cell that asked for it.
 *
 * The cell dedupes the 30-day spend fetch per `slug|credId` with an in-flight
 * set. A second cell for the same key (the Wall and the Atlas both mount one,
 * and StrictMode mounts every effect twice in development) found the key in
 * flight and returned without any way to hear the answer: only the cell that
 * started the fetch ever rendered the spend. The cache is a subscribable
 * module cache, so every cell now reads the value from it.
 */
const fetchLlmPinpoints = vi.fn();
vi.mock('@/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters', () => ({
  fetchLlmPinpoints: (...a: unknown[]) => fetchLlmPinpoints(...a),
  hasLiveAdapter: () => true,
}));
const cred = { id: 'cred-1', name: 'Helicone prod', serviceType: 'helicone' };
vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: (sel: (s: { credentials: unknown[] }) => unknown) => sel({ credentials: [cred] }),
}));
vi.mock('../improve/ImproveContext', () => ({
  useImprove: () => ({ getRaw: () => ({ project: { llm_tracking_credential_id: 'cred-1' } }) }),
}));

import { LlmTrackingCell } from '../LlmTrackingCell';

describe('LlmTrackingCell', () => {
  beforeEach(() => fetchLlmPinpoints.mockReset());

  it('renders the spend in every cell that shares one in-flight fetch', async () => {
    let resolve!: (rows: Array<{ totalCostUsd: number }>) => void;
    fetchLlmPinpoints.mockReturnValue(new Promise((r) => { resolve = r; }));

    // Unique slug: the cache is module-scoped and must not leak across tests.
    render(
      <>
        <span data-testid="a"><LlmTrackingCell slug="shared-1" label="connected" /></span>
        <span data-testid="b"><LlmTrackingCell slug="shared-1" label="connected" /></span>
      </>,
    );
    expect(fetchLlmPinpoints).toHaveBeenCalledTimes(1);

    await act(async () => { resolve([{ totalCostUsd: 3 }, { totalCostUsd: 4.25 }]); });

    expect(screen.getByTestId('a').textContent).toContain('/30d');
    expect(screen.getByTestId('b').textContent).toContain('/30d');
  });
});
