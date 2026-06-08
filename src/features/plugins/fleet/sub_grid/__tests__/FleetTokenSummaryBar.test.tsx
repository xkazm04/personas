/**
 * Unit tests for FleetTokenSummaryBar (fleet-wide token / cache-efficiency bar).
 * tokenSummary is mocked; useTranslation is real.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import type { FleetTokenAggregate } from '@/lib/bindings/FleetTokenAggregate';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('@/api/fleet/fleet', () => ({ tokenSummary: vi.fn() }));

import * as fleetApi from '@/api/fleet/fleet';
import { FleetTokenSummaryBar } from '../FleetTokenSummaryBar';

function aggregate(over: Partial<FleetTokenAggregate> = {}): FleetTokenAggregate {
  return {
    sessionCount: 2,
    tokens: { input: 1000, output: 200, cacheCreation: 0, cacheRead: 3000 },
    totalContextTokens: 4200,
    bloatedCount: 1,
    ...over,
  } as unknown as FleetTokenAggregate;
}

describe('FleetTokenSummaryBar', () => {
  beforeEach(() => vi.mocked(fleetApi.tokenSummary).mockReset());

  it('renders the aggregate (cache hit %, heavy count) for bound sessions', async () => {
    vi.mocked(fleetApi.tokenSummary).mockResolvedValue(aggregate());
    render(<FleetTokenSummaryBar claudeSessionIds={['s1', 's2']} />);
    await screen.findByTestId('fleet-token-summary-bar');
    expect(fleetApi.tokenSummary).toHaveBeenCalledWith(['s1', 's2']);
    // cacheRead 3000 / (input 1000 + cacheRead 3000) = 75%.
    expect(screen.getByText('75% cached')).toBeInTheDocument();
    // bloatedCount 1 → heavy badge.
    expect(screen.getByText('1 heavy')).toBeInTheDocument();
  });

  it('hides the heavy badge when no session is bloated', async () => {
    vi.mocked(fleetApi.tokenSummary).mockResolvedValue(aggregate({ bloatedCount: 0 }));
    render(<FleetTokenSummaryBar claudeSessionIds={['s1']} />);
    await screen.findByTestId('fleet-token-summary-bar');
    expect(screen.queryByText(/heavy/)).not.toBeInTheDocument();
  });

  it('renders nothing with no bound sessions (and does not fetch)', () => {
    const { container } = render(<FleetTokenSummaryBar claudeSessionIds={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(fleetApi.tokenSummary).not.toHaveBeenCalled();
  });

  it('renders nothing when the aggregate has zero sessions', async () => {
    vi.mocked(fleetApi.tokenSummary).mockResolvedValue(aggregate({ sessionCount: 0 }));
    const { container } = render(<FleetTokenSummaryBar claudeSessionIds={['s1']} />);
    await waitFor(() => expect(fleetApi.tokenSummary).toHaveBeenCalled());
    expect(screen.queryByTestId('fleet-token-summary-bar')).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
