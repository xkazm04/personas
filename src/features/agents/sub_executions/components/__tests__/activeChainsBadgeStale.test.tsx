/**
 * A poll that keeps failing must not leave the badge asserting live state: after
 * consecutive failures it flags the list as stale. A transient single failure
 * stays silent and a recovery clears the flag.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const t = {
  agents: {
    executions: new Proxy({}, { get: (_o, key) => `executions.${String(key)}` }),
  },
};
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
}));
vi.mock('@/features/shared/components/display/RelativeTime', () => ({
  RelativeTime: () => <span data-testid="rt" />,
}));
vi.mock('@/features/shared/components/display/Numeric', () => ({ Numeric: () => null }));

const listActiveChains = vi.fn();
vi.mock('@/api/agents/executions', () => ({ listActiveChains: (...a: unknown[]) => listActiveChains(...a) }));

import { ActiveChainsBadge } from '../ActiveChainsBadge';

const chain = {
  chainTraceId: 'abcdefgh1234',
  inFlightCount: 1,
  personaIds: ['p'],
  maxDepth: 1,
  accumulatedCostUsd: 0,
  oldestStartedAt: '2026-07-01T12:00:00.000Z',
};

async function tick(ms = 5_000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('ActiveChainsBadge staleness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listActiveChains.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it('flags the snapshot stale after consecutive poll failures, and clears on recovery', async () => {
    listActiveChains.mockResolvedValueOnce([chain]);
    render(<ActiveChainsBadge />);
    await tick(0);
    expect(screen.getByTestId('active-chains-badge')).toBeTruthy();
    expect(screen.queryByTestId('active-chains-stale')).toBeNull();

    listActiveChains.mockRejectedValue(new Error('ipc down'));
    await tick(); // 1st failure: transient, silent
    expect(screen.queryByTestId('active-chains-stale')).toBeNull();
    await tick(); // 2nd
    await tick(); // 3rd: chronic
    expect(screen.getByTestId('active-chains-stale')).toBeTruthy();

    listActiveChains.mockResolvedValue([chain]);
    await tick();
    expect(screen.queryByTestId('active-chains-stale')).toBeNull();
  });
});
