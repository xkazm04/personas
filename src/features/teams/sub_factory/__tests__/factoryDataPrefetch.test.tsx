import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * A provider that adopts a FAILED prefetch reports the failure.
 *
 * The Mastermind prefetch warms the KPI tree before the page mounts, and a
 * provider mounting meanwhile adopts that promise instead of a second fan-out.
 * The prefetch swallowed its error into `null`, and the adopt path only acted
 * on a non-null result, so when `listProjects` failed the provider kept its
 * cold initial state, `loading: true, error: null`, until something called
 * reload(). Mastermind's `factoryReady = !loading || Boolean(error)` therefore
 * never turned true and its retry banner never listed the KPI family.
 */
vi.mock('@/api/devTools/devTools', () => ({
  listProjects: vi.fn().mockRejectedValue({ error: 'database is locked', kind: 'Database' }),
}));
vi.mock('@/api/devTools/kpis', () => ({ listKpis: vi.fn(), listKpiMeasurementsBulk: vi.fn() }));
vi.mock('@/api/devTools/useCases', () => ({ listUseCases: vi.fn() }));

import { FactoryDataProvider, prefetchFactoryData, useFactoryData } from '../factoryData';

function Probe() {
  const { loading, error } = useFactoryData();
  return <span data-testid="state">{`${loading ? 'loading' : 'settled'}|${error ?? ''}`}</span>;
}

describe('FactoryDataProvider adopting a prefetch', () => {
  it('a failed prefetch settles the provider with the error', async () => {
    const warmed = prefetchFactoryData();
    render(<FactoryDataProvider><Probe /></FactoryDataProvider>);
    await expect(warmed).resolves.toBeNull(); // the prefetch itself still never rejects
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('settled|database is locked'));
  });
});
