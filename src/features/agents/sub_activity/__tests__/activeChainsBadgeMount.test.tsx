/**
 * CHAINS IN FLIGHT REACH A PIXEL.
 *
 * `ActiveChainsBadge` is the sole UI consumer of `list_active_chains` and its
 * only mount was inside `ExecutionList`, which had no consumers — so a chain
 * running across three personas right now rendered nowhere. It is now on the
 * persona Activity tab's PERMANENT header, above the tab strip, so it is
 * visible from every Activity tab rather than only from the runs one.
 *
 * Both directions are pinned: nothing in flight renders literally nothing (the
 * mount must cost no pixels when the fleet is idle), and a chain in flight
 * renders the badge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ActiveChain } from '@/lib/bindings/ActiveChain';

const leaf = (prefix: string) =>
  new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) =>
    section === 'agents'
      ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
      : leaf(String(section)),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

const listActiveChains = vi.fn(async () => [] as ActiveChain[]);
vi.mock('@/api/agents/executions', () => ({
  listActiveChains: () => listActiveChains(),
}));

import { ActivityHeader } from '../ActivityHeader';

function chain(over: Partial<ActiveChain> = {}): ActiveChain {
  return {
    chainTraceId: 'abcdef0123456789',
    inFlightCount: 2,
    personaIds: ['p1', 'p2'],
    maxDepth: 3,
    accumulatedCostUsd: 0.12,
    oldestStartedAt: new Date().toISOString(),
    ...over,
  } as ActiveChain;
}

describe('the Activity tab header mounts the active-chains badge', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders nothing at all when no chain is in flight', async () => {
    listActiveChains.mockResolvedValue([]);
    render(<ActivityHeader personaId="p1" itemCount={0} isLoading={false} onRefresh={() => {}} />);
    await waitFor(() => expect(listActiveChains).toHaveBeenCalled());
    expect(screen.queryByTestId('active-chains-badge')).toBeNull();
  });

  it('renders the badge, with one row per chain, when work is in flight', async () => {
    listActiveChains.mockResolvedValue([chain(), chain({ chainTraceId: 'ffffffff11112222' })]);
    render(<ActivityHeader personaId="p1" itemCount={0} isLoading={false} onRefresh={() => {}} />);
    await waitFor(() => {
      expect(screen.getByTestId('active-chains-badge')).toBeTruthy();
    });
  });
});
